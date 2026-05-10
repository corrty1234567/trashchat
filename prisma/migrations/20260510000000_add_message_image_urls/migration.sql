ALTER TABLE "messages"
  ADD COLUMN "image_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "messages"
SET "image_urls" = ARRAY["image_url"]
WHERE "image_url" IS NOT NULL AND cardinality("image_urls") = 0;
