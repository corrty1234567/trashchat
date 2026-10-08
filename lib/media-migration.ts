import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type * as BlobSdk from "@vercel/blob";
import { decryptMedia, encryptMedia, MAX_MEDIA_BYTES } from "./media-crypto.ts";

type MigrationOptions = {
  prisma: Pick<PrismaClient, "message">;
  blob: Pick<typeof BlobSdk, "list" | "get" | "put" | "del">;
  apply?: boolean;
  report?: (message: string) => void;
};

function blobAliases(value: string) {
  const url = new URL(value);
  const alias = new URL(value);
  alias.hostname = url.hostname.includes(".public.blob.")
    ? url.hostname.replace(".public.blob.", ".blob.")
    : url.hostname.replace(".blob.", ".public.blob.");
  return [...new Set([value, url.href, alias.href])];
}

function references(urls: string[]) {
  return { OR: [{ imageUrl: { in: urls } }, { imageUrls: { hasSome: urls } }, { thumbnailUrls: { hasSome: urls } }] };
}

async function replaceReferences(prisma: MigrationOptions["prisma"], previous: string[], next: string) {
  const oldUrls = new Set(previous);
  for (let attempt = 0; attempt < 5; attempt++) {
    const messages = await prisma.message.findMany({
      where: references(previous),
      select: { id: true, updatedAt: true, imageUrl: true, imageUrls: true, thumbnailUrls: true }
    });
    if (!messages.length) return;
    for (const message of messages) {
      // Do not restore images if a user recalls/changes the message concurrently.
      await prisma.message.updateMany({
        where: { id: message.id, updatedAt: message.updatedAt },
        data: {
          imageUrl: message.imageUrl && oldUrls.has(message.imageUrl) ? next : message.imageUrl,
          imageUrls: message.imageUrls.map((url) => oldUrls.has(url) ? next : url),
          thumbnailUrls: message.thumbnailUrls.map((url) => oldUrls.has(url) ? next : url)
        }
      });
    }
  }
  if (await prisma.message.count({ where: references(previous) })) {
    throw new Error("Concurrent message changes prevented migration. Original image was retained; rerun the command.");
  }
}

export async function migrateLegacyMedia({ prisma, blob, apply = false, report = () => {} }: MigrationOptions) {
  if (apply) decryptMedia(encryptMedia(new Uint8Array([0]), "image/png"));
  const legacy: Awaited<ReturnType<typeof blob.list>>["blobs"] = [];
  // Finish listing before deleting so changing the store cannot skip a page.
  for (const prefix of ["trashchat/", "chorchat/"]) {
    let cursor: string | undefined;
    do {
      const page = await blob.list({ prefix, limit: 1000, cursor });
      legacy.push(...page.blobs.filter((item) => !item.pathname.startsWith("trashchat/sealed/")));
      cursor = page.cursor;
    } while (cursor);
  }
  report(`Found ${legacy.length} legacy public images.`);
  if (!apply) return { legacy: legacy.length, migrated: 0 };

  let migrated = 0;
  for (const original of legacy) {
    const source = await blob.get(original.pathname, { access: "public" });
    if (!source || source.statusCode !== 200 || source.blob.size > MAX_MEDIA_BYTES) {
      throw new Error("An original image could not be read safely. No original was deleted for this image.");
    }
    const content = Buffer.from(await new Response(source.stream).arrayBuffer());
    const type = source.blob.contentType.toLowerCase();
    const pathname = `trashchat/sealed/${createHash("sha256").update(original.url).digest("hex")}.bin`;
    let destination = await blob.get(pathname, { access: "public" });
    if (!destination) {
      await blob.put(pathname, encryptMedia(content, type), {
        access: "public", addRandomSuffix: false, allowOverwrite: false,
        contentType: "application/octet-stream", cacheControlMaxAge: 60
      });
      destination = await blob.get(pathname, { access: "public" });
    }
    if (!destination || destination.statusCode !== 200 || destination.blob.size > MAX_MEDIA_BYTES + 128) {
      throw new Error("The encrypted copy could not be verified. Original image was retained.");
    }
    const verified = decryptMedia(new Uint8Array(await new Response(destination.stream).arrayBuffer()));
    if (!verified.content.equals(content) || verified.contentType !== type) {
      throw new Error("Encrypted image verification failed. Original image was retained.");
    }
    const aliases = blobAliases(original.url);
    await replaceReferences(prisma, aliases, destination.blob.url);
    if (await prisma.message.count({ where: references(aliases) })) {
      throw new Error("Original image is still referenced. Original image was retained.");
    }
    await blob.del(original.url);
    migrated++;
    report(`Protected ${migrated}/${legacy.length} images.`);
  }
  return { legacy: legacy.length, migrated };
}
