ALTER TABLE "messages" ADD COLUMN "thumbnail_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
