const assert = require("node:assert/strict");
const test = require("node:test");
const { msUntilNext2amUtc } = require("../dist/retention.js");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

test("TIE-20/TIE-33 msUntilNext2amUtc targets the next 02:00 UTC when before it today", () => {
  const from = new Date("2026-09-07T01:00:00.000Z");
  const delay = msUntilNext2amUtc(from);
  const target = new Date(from.getTime() + delay);
  assert.equal(target.toISOString(), "2026-09-07T02:00:00.000Z");
});

test("TIE-20/TIE-33 msUntilNext2amUtc rolls over to tomorrow when past 02:00 UTC today", () => {
  const from = new Date("2026-09-07T15:30:00.000Z");
  const delay = msUntilNext2amUtc(from);
  const target = new Date(from.getTime() + delay);
  assert.equal(target.toISOString(), "2026-09-08T02:00:00.000Z");
});

test("TIE-20/TIE-33 msUntilNext2amUtc always returns a value within one day", () => {
  const delay = msUntilNext2amUtc(new Date("2026-09-07T02:00:00.000Z"));
  assert.ok(delay > 0 && delay <= ONE_DAY_MS);
});
