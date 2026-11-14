// HTTP contract tests for the Log Service (IRD-002 §7) — no database needed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { describe, test, beforeEach, afterEach } = require("node:test");
const { createApp } = require("../dist/app.js");

// In-memory LogRepository with the same ordering semantics as PrismaLogRepository: (timestamp, seq).
class InMemoryLogRepository {
  constructor() {
    this.logs = [];
    this.nextSeq = 1n;
    this.failWith = null;
    this.clock = () => new Date();
  }
  guard() {
    if (this.failWith) throw this.failWith;
  }
  async ping() {
    this.guard();
  }
  insert(deployId, entry, timestamp) {
    const log = { id: randomUUID(), deployId, timestamp, level: entry.level, message: entry.message, seq: this.nextSeq++ };
    this.logs.push(log);
    return log;
  }
  async append(deployId, entry) {
    this.guard();
    return this.insert(deployId, entry, this.clock());
  }
  async appendMany(deployId, entries) {
    this.guard();
    const timestamp = this.clock();
    entries.forEach((entry) => this.insert(deployId, entry, timestamp));
    return entries.length;
  }
  async list(deployId, filter, cursor, limit) {
    this.guard();
    const after = (log) =>
      !cursor || log.timestamp > cursor.timestamp || (log.timestamp.getTime() === cursor.timestamp.getTime() && log.seq > cursor.seq);
    const rows = this.logs
      .filter((log) => log.deployId === deployId && (!filter.level || log.level === filter.level) && after(log))
      .sort((a, b) => a.timestamp - b.timestamp || (a.seq < b.seq ? -1 : 1));
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }
}

const deployId = "3f1c2a4e-1111-4222-8333-444455556666";
let repo;
let server;
let baseUrl;

async function call(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  repo = new InMemoryLogRepository();
  server = await new Promise((resolve) => {
    const s = createApp({ repo }).listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

describe("DSC-04 contract", () => {
  test("POST /deploys/:id/logs returns 201 with exactly the snake_case keys", async () => {
    const res = await call(`/deploys/${deployId}/logs`, post({ level: "error", message: "Health check failed" }));
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body).sort(), ["deploy_id", "id", "level", "message", "timestamp"]);
    assert.equal(res.body.deploy_id, deployId);
  });

  for (const [name, path, body] of [
    ["non-UUID deploy id", "/deploys/deploy-42/logs", { level: "info", message: "x" }],
    ["unknown level", `/deploys/${deployId}/logs`, { level: "debug", message: "x" }],
    ["blank message", `/deploys/${deployId}/logs`, { level: "info", message: "   " }],
    ["message over 10000 chars", `/deploys/${deployId}/logs`, { level: "info", message: "x".repeat(10_001) }],
    ["empty batch", `/deploys/${deployId}/logs/batch`, { entries: [] }],
    ["batch over 500", `/deploys/${deployId}/logs/batch`, { entries: Array.from({ length: 501 }, () => ({ level: "info", message: "x" })) }],
    ["batch with one bad entry", `/deploys/${deployId}/logs/batch`, { entries: [{ level: "info", message: "ok" }, { level: "nope", message: "x" }] }]
  ]) {
    test(`rejects ${name} with 400 VALIDATION_ERROR and stores nothing`, async () => {
      const res = await call(path, post(body));
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "VALIDATION_ERROR");
      assert.equal(repo.logs.length, 0);
    });
  }

  test("malformed JSON → 400 INVALID_JSON; unknown route → 404 NOT_FOUND", async () => {
    const bad = await fetch(`${baseUrl}/deploys/${deployId}/logs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "INVALID_JSON");
    const missing = await call("/logs");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "NOT_FOUND");
  });

  test("repository failure → 500 INTERNAL without details", async (t) => {
    t.mock.method(console, "error", () => undefined);
    repo.failWith = new Error("db host secret");
    const res = await call(`/deploys/${deployId}/logs`);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: { code: "INTERNAL", message: "Internal server error" } });
  });
});

describe("DSC-04 ordering, batch, pagination", () => {
  test("batch stores all entries in order and returns { count }", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ level: "info", message: `step ${i}` }));
    const res = await call(`/deploys/${deployId}/logs/batch`, post({ entries }));
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { count: 5 });
    const page = await call(`/deploys/${deployId}/logs`);
    assert.deepEqual(page.body.items.map((l) => l.message), ["step 0", "step 1", "step 2", "step 3", "step 4"]);
  });

  test("logs written in the same millisecond keep insertion order", async () => {
    const fixed = new Date("2026-11-13T10:00:00.000Z");
    repo.clock = () => fixed;
    for (const message of ["a", "b", "c", "d"]) await call(`/deploys/${deployId}/logs`, post({ level: "info", message }));
    const page = await call(`/deploys/${deployId}/logs`);
    assert.deepEqual(page.body.items.map((l) => l.message), ["a", "b", "c", "d"]);
  });

  test("cursor pagination returns every log once; level filter applies across pages", async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ level: i % 3 === 0 ? "error" : "info", message: `line ${i}` }));
    await call(`/deploys/${deployId}/logs/batch`, post({ entries }));

    const seen = [];
    let cursor = null;
    do {
      const res = await call(`/deploys/${deployId}/logs?limit=5${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.body.items.map((l) => l.message));
      cursor = res.body.next_cursor;
    } while (cursor);
    assert.equal(seen.length, 12);
    assert.equal(seen[11], "line 11");

    const errors = await call(`/deploys/${deployId}/logs?level=error&limit=2`);
    assert.deepEqual(errors.body.items.map((l) => l.message), ["line 0", "line 3"]);
    const nextErrors = await call(`/deploys/${deployId}/logs?level=error&limit=2&cursor=${errors.body.next_cursor}`);
    assert.deepEqual(nextErrors.body.items.map((l) => l.message), ["line 6", "line 9"]);
    assert.equal(nextErrors.body.next_cursor, null);
  });

  for (const query of ["limit=0", "limit=201", "level=debug", "cursor=garbage"]) {
    test(`GET logs?${query} → 400`, async () => {
      assert.equal((await call(`/deploys/${deployId}/logs?${query}`)).status, 400);
    });
  }

  test("limit defaults to 50", async () => {
    await call(`/deploys/${deployId}/logs/batch`, post({ entries: Array.from({ length: 60 }, () => ({ level: "info", message: "x" })) }));
    const res = await call(`/deploys/${deployId}/logs`);
    assert.equal(res.body.items.length, 50);
    assert.ok(res.body.next_cursor);
  });
});
