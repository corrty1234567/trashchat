CREATE TABLE "call_signals" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "call_id" TEXT NOT NULL,
  "from" "Sender" NOT NULL,
  "to" "Sender" NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "call_signals_to_created_at_idx" ON "call_signals"("to", "created_at");
CREATE INDEX "call_signals_call_id_created_at_idx" ON "call_signals"("call_id", "created_at");
