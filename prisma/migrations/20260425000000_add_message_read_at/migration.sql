ALTER TABLE "messages" ADD COLUMN "read_at" TIMESTAMP(3);

CREATE INDEX "messages_sender_read_at_idx" ON "messages"("sender", "read_at");
