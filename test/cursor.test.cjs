const assert = require("node:assert/strict");
const test = require("node:test");
const { encodeCursor, decodeCursor } = require("../dist/cursor.js");

test("DSC-04 cursor round-trips timestamp and seq", () => {
  const cursor = { timestamp: new Date("2026-09-07T10:23:45.123Z"), seq: 9007199254740993n };
  const decoded = decodeCursor(encodeCursor(cursor));
  assert.ok(decoded);
  assert.equal(decoded.timestamp.valueOf(), cursor.timestamp.valueOf());
  assert.equal(decoded.seq, cursor.seq, "seq beyond Number.MAX_SAFE_INTEGER survives as bigint");
});

test("DSC-04 decodeCursor rejects invalid input", () => {
  assert.equal(decodeCursor(undefined), null);
  assert.equal(decodeCursor(123), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor("not-base64-with-no-colon"), null);
  assert.equal(decodeCursor(Buffer.from("notanumber:1").toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from("12345").toString("base64url")), null);
  // Pre-DSC-04 cursors used "<ms>:<uuid>" — rejected, the client restarts from the first page.
  assert.equal(decodeCursor(Buffer.from("1757240625123:3f1c2a4e-1111-4222-8333-444455556666").toString("base64")), null);
});
