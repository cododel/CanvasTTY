import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTALLED_PAGE_SIZE,
  SHOWCASE_PAGE_SIZE,
  clampPage,
  pageCount,
  paginate
} from "../src/renderer/src/features/plugins/pluginPagination.ts";

// Plugin stubs: id/name only — the test only cares about the array.
function makePlugins(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `com.test.plugin-${i + 1}`,
    name: `Plugin ${i + 1}`
  }));
}

test("installed page size is 6", () => {
  assert.equal(INSTALLED_PAGE_SIZE, 6);
});

test("showcase page size is 10", () => {
  assert.equal(SHOWCASE_PAGE_SIZE, 10);
});

test("pageCount computes ceiling for exact and partial pages", () => {
  assert.equal(pageCount(0, 6), 0);
  assert.equal(pageCount(6, 6), 1);
  assert.equal(pageCount(7, 6), 2);
  assert.equal(pageCount(12, 6), 2);
  assert.equal(pageCount(13, 6), 3);
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
});

test("pageCount guards invalid input", () => {
  assert.equal(pageCount(-1, 6), 0);
  assert.equal(pageCount(5, 0), 0);
  assert.equal(pageCount(Number.NaN, 6), 0);
  assert.equal(pageCount(5, Number.POSITIVE_INFINITY), 0);
});

test("clampPage stays in range", () => {
  assert.equal(clampPage(0, 0, 6), 0);
  assert.equal(clampPage(0, 6, 6), 0);
  assert.equal(clampPage(1, 6, 6), 0); // 6 items = 1 page, page 1 clamps to 0
  assert.equal(clampPage(1, 12, 6), 1);
  assert.equal(clampPage(5, 12, 6), 1); // out of range → last
  assert.equal(clampPage(-3, 12, 6), 0);
  assert.equal(clampPage(Number.NaN, 12, 6), 0);
});

test("installed plugins: 6 fit one page, 7 split into two pages", () => {
  const six = paginate(makePlugins(6), 0, INSTALLED_PAGE_SIZE);
  assert.equal(six.length, 6);

  const seven = makePlugins(7);
  const p0 = paginate(seven, 0, INSTALLED_PAGE_SIZE);
  const p1 = paginate(seven, 1, INSTALLED_PAGE_SIZE);
  assert.equal(p0.length, 6);
  assert.equal(p1.length, 1);
  assert.equal(p0[0].id, "com.test.plugin-1");
  assert.equal(p1[0].id, "com.test.plugin-7");
  // The first page does not contain items from the second page.
  assert.ok(!p0.some((item) => item.id === "com.test.plugin-7"));
});

test("installed plugins: many stubs paginate without overlap or loss", () => {
  const many = makePlugins(25);
  const pages = [0, 1, 2, 3, 4].map((page) => paginate(many, page, INSTALLED_PAGE_SIZE));
  const ids = pages.flat().map((item) => item.id);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25); // no duplicates
  assert.equal(pageCount(25, INSTALLED_PAGE_SIZE), 5);
});

test("showcase plugins: 10 fit one page, 11 split into two pages", () => {
  const ten = paginate(makePlugins(10), 0, SHOWCASE_PAGE_SIZE);
  assert.equal(ten.length, 10);

  const eleven = makePlugins(11);
  const p0 = paginate(eleven, 0, SHOWCASE_PAGE_SIZE);
  const p1 = paginate(eleven, 1, SHOWCASE_PAGE_SIZE);
  assert.equal(p0.length, 10);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].id, "com.test.plugin-11");
});

test("showcase plugins: many stubs paginate without overlap or loss", () => {
  const many = makePlugins(37);
  const count = pageCount(37, SHOWCASE_PAGE_SIZE);
  assert.equal(count, 4);
  const pages = Array.from({ length: count }, (_, i) => paginate(many, i, SHOWCASE_PAGE_SIZE));
  const ids = pages.flat().map((item) => item.id);
  assert.equal(ids.length, 37);
  assert.equal(new Set(ids).size, 37); // no duplicates, no loss
});

test("paginate returns [] for empty or invalid input", () => {
  assert.deepEqual(paginate([], 0, 6), []);
  assert.deepEqual(paginate(makePlugins(3), 0, 0), []);
  assert.deepEqual(paginate(null, 0, 6), []);
});
