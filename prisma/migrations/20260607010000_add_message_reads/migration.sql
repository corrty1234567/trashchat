CREATE TABLE "message_reads" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "sender" "Sender" NOT NULL,
  "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_reads_message_id_sender_key" ON "message_reads"("message_id", "sender");
CREATE INDEX "message_reads_sender_read_at_idx" ON "message_reads"("sender", "read_at");

ALTER TABLE "message_reads"
  ADD CONSTRAINT "message_reads_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
