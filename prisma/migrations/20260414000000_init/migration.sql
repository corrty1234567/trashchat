CREATE TYPE "Sender" AS ENUM ('CHEN', 'ZUO');

CREATE TABLE "messages" (
  "id" TEXT NOT NULL,
  "sender" "Sender" NOT NULL,
  "text" TEXT,
  "image_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "edited_at" TIMESTAMP(3),
  "recalled_at" TIMESTAMP(3),
  "reply_to_message_id" TEXT,

  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");
CREATE INDEX "messages_reply_to_message_id_idx" ON "messages"("reply_to_message_id");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_reply_to_message_id_fkey"
  FOREIGN KEY ("reply_to_message_id")
  REFERENCES "messages"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
