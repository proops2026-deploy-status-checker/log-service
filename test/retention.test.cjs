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

test("DSC-04 scheduleDailyPurge re-aims at 02:00 UTC after every run (no drift)", async () => {
  const { scheduleDailyPurge } = require("../dist/retention.js");
  let now = new Date("2026-11-13T01:00:00.000Z");
  const timers = [];
  let purges = 0;
  const clock = {
    now: () => now,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimer: () => undefined
  };

  const schedule = scheduleDailyPurge(async () => {
    purges += 1;
  }, clock);
  assert.equal(timers[0].ms, 60 * 60 * 1000, "first run aimed at 02:00 UTC today");

  // The timer fires 7 s late and the purge itself takes 3 s: the next run must still be 02:00 tomorrow,
  // not "24 h after this one" (the old fixed interval drifted by 10 s per day here).
  now = new Date("2026-11-13T02:00:10.000Z");
  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(purges, 1);
  assert.equal(timers[1].ms, ONE_DAY_MS - 10_000);

  schedule.stop();
});

test("DSC-04 scheduleDailyPurge keeps scheduling after a failed purge", async (t) => {
  const { scheduleDailyPurge } = require("../dist/retention.js");
  t.mock.method(console, "error", () => undefined);
  const timers = [];
  const clock = {
    now: () => new Date("2026-11-13T02:00:00.000Z"),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    clearTimer: () => undefined
  };
  const schedule = scheduleDailyPurge(() => Promise.reject(new Error("db down")), clock);
  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 2, "rescheduled despite the failure");
  schedule.stop();
});
