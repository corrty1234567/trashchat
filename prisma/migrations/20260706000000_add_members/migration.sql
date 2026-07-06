CREATE TABLE "members" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_protected" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "members_name_key" ON "members"("name");

INSERT INTO "members" ("id", "name", "is_protected")
VALUES
  ('CHEN', '10', true),
  ('ZUO', '27', true),
  ('SEVENTEEN', '17', true)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "is_protected" = EXCLUDED."is_protected";

ALTER TABLE "messages"
  ALTER COLUMN "sender" TYPE TEXT USING "sender"::TEXT;

ALTER TABLE "message_reads"
  ALTER COLUMN "sender" TYPE TEXT USING "sender"::TEXT;

ALTER TABLE "call_signals"
  ALTER COLUMN "from" TYPE TEXT USING "from"::TEXT,
  ALTER COLUMN "to" TYPE TEXT USING "to"::TEXT;

DROP TYPE IF EXISTS "Sender";
