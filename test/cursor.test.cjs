const assert = require("node:assert/strict");
const test = require("node:test");
const { parseCursor } = require("../dist/cursor.js");

test("TIE-20 parseCursor round-trips a valid cursor", () => {
  const timestamp = new Date("2026-09-07T10:23:45.123Z");
  const encoded = Buffer.from(`${timestamp.valueOf()}:log-id-1`).toString("base64");
  const decoded = parseCursor(encoded);
  assert.ok(decoded);
  assert.equal(decoded.timestamp.valueOf(), timestamp.valueOf());
  assert.equal(decoded.id, "log-id-1");
});

test("TIE-20 parseCursor rejects invalid input", () => {
  assert.equal(parseCursor(undefined), null);
  assert.equal(parseCursor(123), null);
  assert.equal(parseCursor(""), null);
  assert.equal(parseCursor("not-base64-with-no-colon"), null);
  assert.equal(parseCursor(Buffer.from("notanumber:id").toString("base64")), null);
  assert.equal(parseCursor(Buffer.from("12345").toString("base64")), null); // missing ":id"
});
