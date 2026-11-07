/* Writes the Vietnamese text (the default language) into every data-i18n element of public/index.html, so the page is
   drawn at its final size before the scripts run: no layout shift, and something to show at once. The scripts still set
   the text (and switch to English). After changing a text in public/js/i18n.js, run: node scripts/static-text.mjs
   (tests/static-text.test.mjs fails while the page is out of date). */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { t } from "../public/js/i18n.js";

const PAGE = new URL("../public/index.html", import.meta.url);
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* <tag … data-i18n="key" …>text</tag>, where the element holds only text */
export const fillStaticText = (html) =>
  html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/gi, (all, open, tag, key, text, close) => open + escape(t(key)) + close);

export const pageHtml = () => readFileSync(PAGE, "utf8");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const before = pageHtml();
  const after = fillStaticText(before);
  writeFileSync(PAGE, after);
  console.log(before === after ? "public/index.html already up to date" : "public/index.html updated");
}
