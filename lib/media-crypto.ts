import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerDataKey } from "./server-data-key.ts";

const MAGIC = Buffer.from("TRSHIMG1");
// Early versions allowed 8 MB images; new uploads still enforce their 4 MB limit.
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export function encryptMedia(content: Uint8Array, contentType: string) {
  if (content.byteLength > MAX_MEDIA_BYTES || !/^image\/[a-z0-9.+-]{1,80}$/i.test(contentType)) {
    throw new Error("Unsupported image.");
  }
  const type = Buffer.from(contentType.toLowerCase());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getServerDataKey(), iv);
  cipher.setAAD(MAGIC);
  const plaintext = Buffer.concat([Buffer.from([type.length]), type, content]);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptMedia(content: Uint8Array) {
  const value = Buffer.from(content);
  if (value.length < 38 || value.length > MAX_MEDIA_BYTES + 128 || !value.subarray(0, 8).equals(MAGIC)) {
    throw new Error("Invalid encrypted image.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getServerDataKey(), value.subarray(8, 20));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(value.subarray(20, 36));
  const plaintext = Buffer.concat([decipher.update(value.subarray(36)), decipher.final()]);
  const typeLength = plaintext[0];
  const contentType = plaintext.subarray(1, 1 + typeLength).toString("utf8");
  if (!/^image\/[a-z0-9.+-]{1,80}$/.test(contentType) || plaintext.length < 1 + typeLength) {
    throw new Error("Invalid image type.");
  }
  return { contentType, content: plaintext.subarray(1 + typeLength) };
}
