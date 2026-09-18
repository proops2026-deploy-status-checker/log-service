-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('info', 'warn', 'error');

-- CreateTable
CREATE TABLE "log_entries" (
    "id" TEXT NOT NULL,
    "deploy_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purge_audit_log" (
    "id" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "deleted_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "error_message" TEXT,

    CONSTRAINT "purge_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "log_entries_deploy_id_timestamp_idx" ON "log_entries"("deploy_id", "timestamp" DESC);

