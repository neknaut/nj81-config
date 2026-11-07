import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStaticText, pageHtml } from "../scripts/static-text.mjs";

test("index.html holds the Vietnamese text of every data-i18n element (run node scripts/static-text.mjs)", () => {
  const html = pageHtml();
  assert.equal(fillStaticText(html), html);
});
