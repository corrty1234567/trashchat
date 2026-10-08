export function getServerDataKey() {
  const key = process.env.TRASHCHAT_DATA_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error("TRASHCHAT_DATA_KEY must be a stable 32-byte hexadecimal key.");
  }
  return Buffer.from(key, "hex");
}
