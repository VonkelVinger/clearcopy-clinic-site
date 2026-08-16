"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { transformParagraph } = require("./preflight-core");

function run(text) {
  const stats = { indefiniteArticle:0, numericApostropheS:0, doubleQuotePairs:0, singleQuotePairs:0, ambiguousDouble:false, ambiguousSingle:false };
  return { text: transformParagraph(text, stats), stats };
}

test("normalises Afrikaans indefinite article and numeric apostrophe-s", () => {
  assert.equal(run("'n Mens in die 1950's").text, "’n Mens in die 1950’s");
});

test("normalises clear primary double quotes", () => {
  assert.equal(run('Hy sê: "Dit werk."').text, 'Hy sê: “Dit werk.”');
});

test("converts primary single-quoted passage to Afrikaans double quotes", () => {
  assert.equal(run("Sy sê: 'Dit werk.'").text, "Sy sê: “Dit werk.”");
});

test("uses single smart quotes for nested quotation", () => {
  assert.equal(run("Hy sê: “Sy het gesê: 'Dit werk.'”").text, "Hy sê: “Sy het gesê: ‘Dit werk.’”");
});

test("does not alter internal apostrophes or ambiguous measurement marks", () => {
  const result = run("O'Connor het 6' 2\" gemeet.");
  assert.equal(result.text, "O'Connor het 6' 2\" gemeet.");
  assert.equal(result.stats.ambiguousSingle, true);
  assert.equal(result.stats.ambiguousDouble, true);
});
