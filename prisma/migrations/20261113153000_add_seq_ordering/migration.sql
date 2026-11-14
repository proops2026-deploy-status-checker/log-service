-- DSC-04: stable log ordering. `id` is a random UUID, so ORDER BY (timestamp, id) shuffled logs
-- written in the same millisecond. `seq` records insertion order and becomes the tie-breaker.
-- Note: adding a BIGSERIAL column rewrites the table (ACCESS EXCLUSIVE lock) — fine at current size;
-- on a large table this would be split into add-nullable / backfill / set-not-null steps.

-- AlterTable
ALTER TABLE "log_entries" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "log_entries_seq_key" ON "log_entries"("seq");

-- CreateIndex (new read path first, so there is never a window without an index for GET /deploys/:id/logs)
CREATE INDEX "log_entries_deploy_id_timestamp_seq_idx" ON "log_entries"("deploy_id", "timestamp", "seq");

-- DropIndex
DROP INDEX "log_entries_deploy_id_timestamp_idx";
