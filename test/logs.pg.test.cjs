// Integration tests against a real PostgreSQL: ordering by (timestamp, seq), keyset pagination,
// and the AC-10 retention purge. Skipped unless TEST_DATABASE_URL points at a migrated, disposable database.
const assert = require("node:assert/strict");
const { describe, test, before, after, beforeEach } = require("node:test");

const databaseUrl = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("Log Service against PostgreSQL", { skip: !databaseUrl && "TEST_DATABASE_URL not set" }, () => {
  let prisma;
  let repo;
  let purgeExpiredLogs;
  const deployId = "3f1c2a4e-1111-4222-8333-444455556666";

  before(() => {
    const { PrismaClient } = require("@prisma/client");
    const { PrismaLogRepository } = require("../dist/repository.js");
    ({ purgeExpiredLogs } = require("../dist/retention.js"));
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    repo = new PrismaLogRepository(prisma);
  });

  after(() => prisma.$disconnect());

  beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE TABLE "log_entries", "purge_audit_log"'));

  test("DSC-04: a 300-line batch shares one timestamp yet reads back in sent order", async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({ level: "info", message: `line ${i}` }));
    assert.equal(await repo.appendMany(deployId, entries), 300);

    const seen = [];
    let cursor;
    do {
      const page = await repo.list(deployId, {}, cursor, 70);
      seen.push(...page.items.map((l) => l.message));
      const last = page.items.at(-1);
      cursor = page.hasMore ? { timestamp: last.timestamp, seq: last.seq } : undefined;
    } while (cursor);

    assert.deepEqual(seen, entries.map((e) => e.message));
  });

  test("DSC-04: rows with identical timestamps are ordered by seq, not by random id", async () => {
    const ts = new Date("2026-11-13T10:00:00.000Z");
    for (const message of ["first", "second", "third", "fourth", "fifth"]) {
      await prisma.logEntry.create({ data: { deployId, level: "info", message, timestamp: ts } });
    }
    const page = await repo.list(deployId, {}, undefined, 10);
    assert.deepEqual(page.items.map((l) => l.message), ["first", "second", "third", "fourth", "fifth"]);
  });

  test("DSC-04: level filter + other deploys are excluded", async () => {
    await repo.appendMany(deployId, [{ level: "info", message: "a" }, { level: "error", message: "b" }]);
    await repo.append("9a9a9a9a-1111-4222-8333-444455556666", { level: "error", message: "other deploy" });
    const page = await repo.list(deployId, { level: "error" }, undefined, 10);
    assert.deepEqual(page.items.map((l) => l.message), ["b"]);
  });

  test("AC-10: purge deletes logs older than 30 days, keeps newer ones, audits, and is idempotent", async () => {
    const now = new Date("2026-11-13T02:00:00.000Z");
    await prisma.logEntry.create({ data: { deployId, level: "info", message: "31 days old", timestamp: new Date(now - 31 * DAY_MS) } });
    await prisma.logEntry.create({ data: { deployId, level: "info", message: "30 days + 1 ms", timestamp: new Date(now - 30 * DAY_MS - 1) } });
    await prisma.logEntry.create({ data: { deployId, level: "info", message: "exactly 30 days", timestamp: new Date(now - 30 * DAY_MS) } });
    await prisma.logEntry.create({ data: { deployId, level: "info", message: "1 day old", timestamp: new Date(now - DAY_MS) } });

    const first = await purgeExpiredLogs(prisma, now);
    assert.equal(first.deletedCount, 2);
    const remaining = (await prisma.logEntry.findMany({ orderBy: { seq: "asc" } })).map((l) => l.message);
    assert.deepEqual(remaining, ["exactly 30 days", "1 day old"]);

    const second = await purgeExpiredLogs(prisma, now);
    assert.equal(second.deletedCount, 0, "idempotent");

    const audit = await prisma.purgeAuditLog.findMany({ orderBy: { deletedCount: "desc" } });
    assert.deepEqual(audit.map((a) => [a.status, a.deletedCount]), [["success", 2], ["success", 0]]);
    assert.equal(audit[0].cutoff.toISOString(), "2026-10-14T02:00:00.000Z");
  });
});
