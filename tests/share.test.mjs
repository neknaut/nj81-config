import test from "node:test";
import assert from "node:assert/strict";
import { pageList } from "../public/js/share.js";

test("page numbers: first, last, the current page with a neighbour each side, … for the rest, always 7 items", () => {
  assert.deepEqual(pageList(1, 15), [1, 2, 3, 4, 5, "…", 15]);
  assert.deepEqual(pageList(4, 15), [1, 2, 3, 4, 5, "…", 15]);
  assert.deepEqual(pageList(5, 15), [1, "…", 4, 5, 6, "…", 15]);
  assert.deepEqual(pageList(8, 15), [1, "…", 7, 8, 9, "…", 15]);
  assert.deepEqual(pageList(12, 15), [1, "…", 11, 12, 13, 14, 15]);
  assert.deepEqual(pageList(15, 15), [1, "…", 11, 12, 13, 14, 15]);
  for (let page = 1; page <= 15; page += 1) { assert.equal(pageList(page, 15).length, 7, `page ${page}: the pager never changes width`); }
});

test("page numbers: short lists in full, and 5 items on a narrow screen", () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageList(8, 15, 0), [1, "…", 8, "…", 15]);
  for (let page = 1; page <= 15; page += 1) { assert.equal(pageList(page, 15, 0).length, 5); }
});
