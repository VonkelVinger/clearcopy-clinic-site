"use strict";

const crypto = require("node:crypto");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { processDocx } = require("./preflight-core");

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "https://clearcopy.clinic"
]);
const MAX_DOCX_BYTES = 8 * 1024 * 1024;
const MAX_REQUESTS_PER_CODE_PER_DAY = 20;
const MAX_REQUESTS_TOTAL_PER_DAY = 100;

const PILOT_ACCESS_CODES = defineSecret("PILOT_ACCESS_CODES");
const PILOT_ACCESS_PEPPER = defineSecret("PILOT_ACCESS_PEPPER");

function sendJson(response, status, body) {
  response.set("Cache-Control", "no-store");
  response.status(status).json(body);
}

function setCors(request, response) {
  const origin = request.get("origin");
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  response.set("Access-Control-Allow-Origin", origin);
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Access-Control-Max-Age", "600");
  return true;
}

function cleanText(value) { return typeof value === "string" ? value.trim() : ""; }
function digestCode(code, pepper) { return crypto.createHmac("sha256", pepper).update(code, "utf8").digest("hex"); }
function matchesCode(submittedDigest, configuredCodes, pepper) {
  const submitted = Buffer.from(submittedDigest, "hex");
  let matched = false;
  for (const candidate of configuredCodes.split(",").map((v) => v.trim()).filter(Boolean)) {
    const expected = Buffer.from(digestCode(candidate, pepper), "hex");
    matched = crypto.timingSafeEqual(submitted, expected) || matched;
  }
  return matched;
}
function utcDay() { return new Date().toISOString().slice(0, 10); }
function cleanedName(name) {
  const base = cleanText(name).replace(/[\\/]/g, "_");
  return base.toLowerCase().endsWith(".docx") ? base : "document.docx";
}
function outputName(name) { return name.replace(/\.docx$/i, "_preflight.docx"); }

const dailyCounts = new Map();
function withinRateLimit(digest) {
  const day = utcDay();
  return (dailyCounts.get(`total:${day}`) || 0) < MAX_REQUESTS_TOTAL_PER_DAY &&
    (dailyCounts.get(`code:${day}:${digest}`) || 0) < MAX_REQUESTS_PER_CODE_PER_DAY;
}
function recordRequest(digest) {
  const day = utcDay();
  dailyCounts.set(`total:${day}`, (dailyCounts.get(`total:${day}`) || 0) + 1);
  dailyCounts.set(`code:${day}:${digest}`, (dailyCounts.get(`code:${day}:${digest}`) || 0) + 1);
}

async function handler(request, response) {
  const started = Date.now();
  if (!setCors(request, response)) return sendJson(response, 403, { error: "This origin is not allowed." });
  if (request.method === "OPTIONS") return response.status(204).send("");
  if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST for Afrikaans Preflight." });
  if (!request.is("application/json") || !request.body || typeof request.body !== "object") {
    return sendJson(response, 400, { error: "Send a JSON Preflight request." });
  }

  const accessCode = cleanText(request.body.accessCode);
  const fileName = cleanedName(request.body.fileName);
  const fileBase64 = cleanText(request.body.fileBase64);
  if (!/^[A-Za-z0-9-]{8,32}$/.test(accessCode)) return sendJson(response, 400, { error: "Enter a valid access code." });
  if (!fileBase64) return sendJson(response, 400, { error: "Choose a DOCX file." });

  const configuredCodes = PILOT_ACCESS_CODES.value();
  const pepper = PILOT_ACCESS_PEPPER.value();
  if (!configuredCodes || !pepper) return sendJson(response, 503, { error: "Afrikaans Preflight is temporarily unavailable." });
  const digest = digestCode(accessCode, pepper);
  if (!matchesCode(digest, configuredCodes, pepper)) return sendJson(response, 401, { error: "Invalid or expired access code." });
  if (!withinRateLimit(digest)) return sendJson(response, 429, { error: "The Preflight request limit has been reached for today." });

  let input;
  try { input = Buffer.from(fileBase64, "base64"); } catch { return sendJson(response, 400, { error: "The uploaded file could not be read." }); }
  if (!input.length || input.length > MAX_DOCX_BYTES) return sendJson(response, 413, { error: "Use a DOCX file no larger than 8 MB." });
  if (input.length < 4 || input.readUInt32LE(0) !== 0x04034b50) return sendJson(response, 400, { error: "The uploaded file does not appear to be a valid DOCX file." });

  try {
    const result = processDocx(input, fileName);
    recordRequest(digest);
    const counts = result.report.counts;
    const automaticChanges = counts.indefiniteArticle + counts.numericApostropheS +
      (2 * counts.doubleQuotePairs) + (2 * counts.singleQuotePairs);
    logger.info({ event: "afrikaans_preflight_success", durationMs: Date.now() - started, inputBytes: input.length, automaticChanges, flags: result.report.flags.length });
    return sendJson(response, 200, {
      version: "preflight-v1",
      fileName: outputName(fileName),
      fileBase64: result.buffer.toString("base64"),
      report: result.report
    });
  } catch (error) {
    logger.warn({ event: "afrikaans_preflight_failure", reason: error && error.message ? error.message : "unknown" });
    const invalid = ["invalid-zip", "invalid-central-directory", "invalid-local-header", "zip-size-mismatch", "unsupported-zip-compression", "not-a-docx"].includes(error && error.message);
    return sendJson(response, invalid ? 400 : 500, { error: invalid ? "This DOCX file could not be processed safely." : "Afrikaans Preflight is temporarily unavailable." });
  }
}

const afrikaansPreflight = onRequest({
  cors: false,
  maxInstances: 1,
  concurrency: 2,
  timeoutSeconds: 60,
  memory: "512MiB",
  secrets: [PILOT_ACCESS_CODES, PILOT_ACCESS_PEPPER]
}, handler);

module.exports = { afrikaansPreflight, __testables: { cleanedName, outputName, MAX_DOCX_BYTES } };
