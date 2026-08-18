import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSemver,
  isValidSemver,
  satisfiesHostVersion
} from "../src/shared/hostVersion.ts";

test("isValidSemver accepts plain and pre-release versions", () => {
  assert.equal(isValidSemver("1.2.3"), true);
  assert.equal(isValidSemver("0.0.1"), true);
  assert.equal(isValidSemver("2.0.0-beta.1"), true);
  assert.equal(isValidSemver("1.2.3+build.5"), true);
  assert.equal(isValidSemver("1.2"), false);
  assert.equal(isValidSemver("v1.2.3"), false);
  assert.equal(isValidSemver("abc"), false);
  assert.equal(isValidSemver(42), false);
  assert.equal(isValidSemver(""), false);
});

test("compareSemver orders versions", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.2.0", "1.1.9"), 1);
  assert.equal(compareSemver("1.1.9", "1.2.0"), -1);
  assert.equal(compareSemver("2.0.0", "1.99.99"), 1);
  assert.equal(compareSemver("0.9.9", "0.10.0"), -1);
  // Invalid values are treated as 0.0.0 (legacy behavior)
  assert.equal(compareSemver("nonsense", "0.0.1"), -1);
});

test("satisfiesHostVersion accepts legacy (no constraint) and compatible versions", () => {
  assert.equal(satisfiesHostVersion(undefined, "1.2.1"), true);
  assert.equal(satisfiesHostVersion("1.2.0", "1.2.1"), true);
  assert.equal(satisfiesHostVersion("1.2.1", "1.2.1"), true);
  assert.equal(satisfiesHostVersion("0.9.0", "1.2.1"), true);
});

test("satisfiesHostVersion rejects plugins written for newer hosts", () => {
  assert.equal(satisfiesHostVersion("2.0.0", "1.2.1"), false);
  assert.equal(satisfiesHostVersion("1.3.0", "1.2.1"), false);
  // An invalid value does not block (malformed treated as no constraint)
  assert.equal(satisfiesHostVersion("not-a-version", "1.2.1"), true);
});
