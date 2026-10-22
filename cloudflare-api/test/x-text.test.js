import assert from "node:assert/strict";
import test from "node:test";
import { xTextMetrics } from "../src/x-text.js";

test("X counts Unicode, emoji and URLs using weighted post lengths", () => {
  assert.deepEqual(xTextMetrics("a".repeat(280)), { weightedLength: 280, valid: true });
  assert.deepEqual(xTextMetrics("a".repeat(281)), { weightedLength: 281, valid: false });
  assert.deepEqual(xTextMetrics("✨".repeat(140)), { weightedLength: 280, valid: true });
  assert.deepEqual(xTextMetrics("✨".repeat(141)), { weightedLength: 282, valid: false });
  assert.deepEqual(xTextMetrics("界".repeat(140)), { weightedLength: 280, valid: true });
  assert.deepEqual(xTextMetrics(`${"https://example.com/a/very/long/path".padEnd(240, "x")} hello`), { weightedLength: 29, valid: true });
});

test("X rejects control characters and counts joined emoji as one emoji", () => {
  assert.equal(xTextMetrics("hello\uFFFFworld").valid, false);
  assert.deepEqual(xTextMetrics("👩‍💻".repeat(140)), { weightedLength: 280, valid: true });
});
