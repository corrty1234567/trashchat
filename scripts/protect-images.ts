import { PrismaClient } from "@prisma/client";
import * as blob from "@vercel/blob";
import { migrateLegacyMedia } from "../lib/media-migration.ts";

const prisma = new PrismaClient();
try {
  if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Load the production DATABASE_URL and BLOB_READ_WRITE_TOKEN in .env first.");
  }
  const apply = process.argv.includes("--apply");
  if (!apply) console.log("Dry run only. Pass --apply to protect old images and remove their public originals.");
  const result = await migrateLegacyMedia({ prisma, blob, apply, report: console.log });
  console.log(`Completed: ${result.migrated} protected; ${result.legacy} legacy images found.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Image migration failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
