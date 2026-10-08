CREATE TABLE "call_records" (
    "id" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "callee" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "call_records_caller_started_at_id_idx" ON "call_records"("caller", "started_at", "id");
CREATE INDEX "call_records_callee_started_at_id_idx" ON "call_records"("callee", "started_at", "id");
