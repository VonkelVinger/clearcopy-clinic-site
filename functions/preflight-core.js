"use strict";

const zlib = require("node:zlib");

const TARGET_WORD_XML = /^(word\/(document|footnotes|endnotes|comments)\.xml|word\/header\d+\.xml|word\/footer\d+\.xml)$/;

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("invalid-zip");
}

function unzip(buffer) {
  const eocd = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid-central-directory");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const modTime = buffer.readUInt16LE(offset + 12);
    const modDate = buffer.readUInt16LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const externalAttrs = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameBuffer = buffer.subarray(offset + 46, offset + 46 + nameLen);
    const name = nameBuffer.toString((flags & 0x0800) ? "utf8" : "utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("invalid-local-header");
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error("unsupported-zip-compression");
    if (data.length !== uncompressedSize) throw new Error("zip-size-mismatch");
    entries.push({ name, flags, method, modTime, modDate, externalAttrs, data });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const method = entry.method === 0 ? 0 : 8;
    const compressed = method === 0 ? data : zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(entry.modTime || 0, 10);
    local.writeUInt16LE(entry.modDate || 0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([local, name, compressed]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(entry.modTime || 0, 12);
    central.writeUInt16LE(entry.modDate || 0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.externalAttrs || 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(Buffer.concat([central, name]));
    localOffset += localRecord.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function decodeXml(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function encodeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isWhitespace(ch) { return !ch || /\s/u.test(ch); }
function isWordChar(ch) { return Boolean(ch) && /[\p{L}\p{N}]/u.test(ch); }
function openPrev(ch) { return !ch || isWhitespace(ch) || /[([{–—:;“‘]/u.test(ch); }
function closeNext(ch) { return !ch || isWhitespace(ch) || /[.,!?;:)}\]–—”’]/u.test(ch); }

function pairStraightQuotes(chars, indexes) {
  if (indexes.length % 2 !== 0) return null;
  const pairs = [];
  for (let n = 0; n < indexes.length; n += 2) {
    const open = indexes[n];
    const close = indexes[n + 1];
    if (close <= open + 1) return null;
    const openOk = !isWhitespace(chars[open + 1]) && openPrev(chars[open - 1]);
    const closeOk = !isWhitespace(chars[close - 1]) && closeNext(chars[close + 1]);
    if (!openOk || !closeOk) return null;
    pairs.push([open, close]);
  }
  return pairs;
}

function getDoubleSpans(chars) {
  const spans = [];
  let open = null;
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === "“") open = i;
    else if (chars[i] === "”" && open !== null) { spans.push([open, i]); open = null; }
  }
  return spans;
}

function transformParagraph(text, stats) {
  let value = text;
  value = value.replace(/(^|[^\p{L}\p{N}])['‘]n\b/gu, (match, prefix) => {
    stats.indefiniteArticle += 1;
    return `${prefix}’n`;
  });
  value = value.replace(/\b(\d{2,4})['‘]s\b/gu, (_, digits) => {
    stats.numericApostropheS += 1;
    return `${digits}’s`;
  });

  let chars = [...value];
  const doubleIndexes = [];
  for (let i = 0; i < chars.length; i += 1) if (chars[i] === '"') doubleIndexes.push(i);
  if (doubleIndexes.length) {
    const pairs = pairStraightQuotes(chars, doubleIndexes);
    if (!pairs) stats.ambiguousDouble = true;
    else for (const [open, close] of pairs) {
      chars[open] = "“"; chars[close] = "”"; stats.doubleQuotePairs += 1;
    }
  }

  const singleIndexes = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== "'") continue;
    if (isWordChar(chars[i - 1]) && isWordChar(chars[i + 1])) continue;
    singleIndexes.push(i);
  }
  if (singleIndexes.length) {
    const pairs = pairStraightQuotes(chars, singleIndexes);
    if (!pairs) stats.ambiguousSingle = true;
    else {
      const doubleSpans = getDoubleSpans(chars);
      for (const [open, close] of pairs) {
        const nested = doubleSpans.some(([dOpen, dClose]) => dOpen < open && close < dClose);
        chars[open] = nested ? "‘" : "“";
        chars[close] = nested ? "’" : "”";
        stats.singleQuotePairs += 1;
      }
    }
  }
  return chars.join("");
}

function processXml(xml, report, partName) {
  let paragraphNo = 0;
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    paragraphNo += 1;
    const nodes = [];
    paragraph.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, inner) => { nodes.push(decodeXml(inner)); return _; });
    if (!nodes.length) return paragraph;
    const original = nodes.join("");
    const stats = {
      indefiniteArticle: 0, numericApostropheS: 0, doubleQuotePairs: 0, singleQuotePairs: 0,
      ambiguousDouble: false, ambiguousSingle: false
    };
    const transformed = transformParagraph(original, stats);
    report.counts.indefiniteArticle += stats.indefiniteArticle;
    report.counts.numericApostropheS += stats.numericApostropheS;
    report.counts.doubleQuotePairs += stats.doubleQuotePairs;
    report.counts.singleQuotePairs += stats.singleQuotePairs;
    if ((stats.ambiguousDouble || stats.ambiguousSingle) && report.flags.length < 100) {
      const kinds = [stats.ambiguousDouble ? "double quotes" : null, stats.ambiguousSingle ? "single quotes" : null].filter(Boolean).join(" and ");
      report.flags.push({ part: partName, paragraph: paragraphNo, issue: `Ambiguous ${kinds}`, excerpt: original.trim().slice(0, 220) });
    }
    if (transformed === original) return paragraph;
    const transformedChars = [...transformed];
    let cursor = 0;
    let nodeIndex = 0;
    return paragraph.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (whole, start, inner, end) => {
      const originalNode = nodes[nodeIndex++] || "";
      const length = [...originalNode].length;
      const replacement = transformedChars.slice(cursor, cursor + length).join("");
      cursor += length;
      return `${start}${encodeXml(replacement)}${end}`;
    });
  });
}

function makeReportText(report) {
  const c = report.counts;
  const total = c.indefiniteArticle + c.numericApostropheS + (c.doubleQuotePairs * 2) + (c.singleQuotePairs * 2);
  const lines = [
    "ClearCopy Clinic – Afrikaans Preflight report",
    "",
    `File: ${report.originalFileName}`,
    `Automatic character changes: ${total}`,
    `  ’n normalisations: ${c.indefiniteArticle}`,
    `  Numeric apostrophe-s normalisations: ${c.numericApostropheS}`,
    `  Double-quote pairs normalised: ${c.doubleQuotePairs}`,
    `  Single-quoted passages normalised: ${c.singleQuotePairs}`,
    `Paragraphs flagged for manual review: ${report.flags.length}`,
    "",
    "Preflight performs conservative mechanical cleanup only. It does not check translation quality, grammar, facts, meaning or house-style decisions beyond the listed rules."
  ];
  if (report.flags.length) {
    lines.push("", "Manual review flags:");
    report.flags.forEach((flag, i) => lines.push(`${i + 1}. ${flag.part}, paragraph ${flag.paragraph}: ${flag.issue}\n   ${flag.excerpt}`));
  }
  return lines.join("\n");
}

function processDocx(buffer, originalFileName = "document.docx") {
  const entries = unzip(buffer);
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) throw new Error("not-a-docx");
  const report = {
    version: "preflight-v1",
    originalFileName,
    counts: { indefiniteArticle: 0, numericApostropheS: 0, doubleQuotePairs: 0, singleQuotePairs: 0 },
    flags: []
  };
  for (const entry of entries) {
    if (!TARGET_WORD_XML.test(entry.name)) continue;
    const xml = entry.data.toString("utf8");
    entry.data = Buffer.from(processXml(xml, report, entry.name), "utf8");
  }
  report.reportText = makeReportText(report);
  return { buffer: zip(entries), report };
}

module.exports = { processDocx, transformParagraph, processXml, unzip, zip };
