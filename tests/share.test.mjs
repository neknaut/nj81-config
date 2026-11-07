import test from "node:test";
import assert from "node:assert/strict";
import { pageList } from "../public/js/share.js";

test("page numbers: the first two, the last two, the current page with its neighbours, … for the rest", () => {
  assert.deepEqual(pageList(1, 15), [1, 2, "…", 14, 15]);
  assert.deepEqual(pageList(8, 15), [1, 2, "…", 7, 8, 9, "…", 14, 15]);
  assert.deepEqual(pageList(5, 15), [1, 2, 3, 4, 5, 6, "…", 14, 15], "one page left out is shown, not …");
  assert.deepEqual(pageList(15, 15), [1, 2, "…", 14, 15]);
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});
