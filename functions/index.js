"use strict";

const crypto = require("node:crypto");
const OpenAI = require("openai");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "https://clearcopy.clinic"
]);
const STORY_TYPES = new Set(["hard-news", "feature", "opinion", "community-journalism", "digital-social"]);
const CATEGORIES = ["Accuracy", "Clarity", "Specificity", "News value", "Style", "Fairness and risk"];
const RATINGS = new Set(["Strong", "Needs attention", "Serious problem"]);
const PER_CODE_DAILY_LIMIT = 2;
const TOTAL_DAILY_LIMIT = 10;

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const PILOT_ACCESS_CODES = defineSecret("PILOT_ACCESS_CODES");
const PILOT_ACCESS_PEPPER = defineSecret("PILOT_ACCESS_PEPPER");

const ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "mode", "studentAssessment", "publishedAssessment", "nextStep"],
  properties: {
    version: { type: "string", enum: ["pilot-v1"] },
    mode: { type: "string", enum: ["live"] },
    studentAssessment: { $ref: "#/$defs/assessment" },
    publishedAssessment: { anyOf: [{ $ref: "#/$defs/assessment" }, { type: "null" }] },
    nextStep: { type: "string", minLength: 1, maxLength: 500 }
  },
  $defs: {
    assessment: {
      type: "object",
      additionalProperties: false,
      required: ["overallRating", "summary", "categories"],
      properties: {
        overallRating: { type: "string", enum: [...RATINGS] },
        summary: { type: "string", minLength: 1, maxLength: 600 },
        categories: {
          type: "array", minItems: 6, maxItems: 6,
          items: { $ref: "#/$defs/category" }
        }
      }
    },
    category: {
      type: "object",
      additionalProperties: false,
      required: ["category", "rating", "storyEvidence", "diagnosis", "coachingQuestions", "seriousWarning"],
      properties: {
        category: { type: "string", enum: CATEGORIES },
        rating: { type: "string", enum: [...RATINGS] },
        storyEvidence: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", minLength: 1, maxLength: 350 } },
        diagnosis: { type: "string", minLength: 1, maxLength: 450 },
        coachingQuestions: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", minLength: 1, maxLength: 250 } },
        seriousWarning: { type: ["string", "null"], maxLength: 450 }
      }
    }
  }
};

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

function getJsonBody(request) {
  if (!request.is("application/json")) return null;
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return null; }
  }
  return null;
}

function cleanText(value) { return typeof value === "string" ? value.trim() : ""; }

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON submission.";
  const allowedKeys = new Set(["accessCode", "storyType", "storySummary", "proposedHeadline", "publishedHeadline"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return "The submission contains an unsupported field.";
  const submission = {
    accessCode: cleanText(body.accessCode), storyType: cleanText(body.storyType),
    storySummary: cleanText(body.storySummary), proposedHeadline: cleanText(body.proposedHeadline),
    publishedHeadline: cleanText(body.publishedHeadline)
  };
  if (!/^[A-Za-z0-9-]{8,32}$/.test(submission.accessCode)) return "Enter a valid pilot access code.";
  if (!STORY_TYPES.has(submission.storyType)) return "Choose a valid story type.";
  if (submission.storySummary.length < 80) return "Add at least 80 characters of story context.";
  if (submission.storySummary.length > 4000) return "Keep the story context to 4,000 characters or fewer.";
  if (submission.proposedHeadline.length < 5 || submission.proposedHeadline.length > 140) return "Enter a headline between 5 and 140 characters.";
  if (submission.publishedHeadline.length > 140) return "Keep the published headline to 140 characters or fewer.";
  return submission;
}

function codeDigest(code, pepper) {
  return crypto.createHmac("sha256", pepper).update(code, "utf8").digest("hex");
}

function safelyMatchesPilotCode(submittedDigest, configuredCodes, pepper) {
  const candidates = configuredCodes.split(",").map((code) => code.trim()).filter(Boolean);
  let matched = false;
  for (const candidate of candidates) {
    const candidateDigest = Buffer.from(codeDigest(candidate, pepper), "hex");
    const submitted = Buffer.from(submittedDigest, "hex");
    matched = crypto.timingSafeEqual(submitted, candidateDigest) || matched;
  }
  return matched;
}

function utcDay(now) { return now().toISOString().slice(0, 10); }

function hasReplacementHeadline(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasReplacementHeadline);
  return Object.entries(value).some(([key, item]) => key === "replacementHeadline" || hasReplacementHeadline(item));
}

function isValidAssessment(assessment) {
  return assessment && RATINGS.has(assessment.overallRating) && typeof assessment.summary === "string" &&
    Array.isArray(assessment.categories) && assessment.categories.length === 6 && assessment.categories.every((item, index) =>
      item && item.category === CATEGORIES[index] && RATINGS.has(item.rating) && typeof item.diagnosis === "string" &&
      Array.isArray(item.storyEvidence) && Array.isArray(item.coachingQuestions) &&
      (typeof item.seriousWarning === "string" || item.seriousWarning === null));
}

function isValidResult(result, hasPublishedHeadline) {
  return result && result.version === "pilot-v1" && result.mode === "live" && typeof result.nextStep === "string" &&
    isValidAssessment(result.studentAssessment) &&
    (hasPublishedHeadline ? isValidAssessment(result.publishedAssessment) : result.publishedAssessment === null) &&
    !hasReplacementHeadline(result);
}

function assessmentInstructions() {
  return `You are Headline Clinic, a journalism-student coaching tool. Assess headlines only against the supplied story summary; never use outside facts or context. Do not generate, suggest, or silently rewrite any headline. Assess exactly these categories in this order: Accuracy, Clarity, Specificity, News value, Style, Fairness and risk. Ratings are exactly Strong, Needs attention, or Serious problem. Explain each finding with specific supplied-story evidence and give useful coaching questions. Distinguish confirmed events from proposals, recommendations, allegations, predictions, and future events. A headline that turns one of those into a completed/established fact is a Serious problem for Accuracy when materially misleading. Use seriousWarning only when genuinely warranted, and make unresolved evidence, legal, privacy, safety, or fairness concerns explicit. Assess an optional published headline independently; it has no special authority. Keep the entire result concise, under roughly 900 output tokens. Return the required JSON only.`;
}

async function requestAssessment(client, submission, digest) {
  const input = JSON.stringify({
    storyType: submission.storyType,
    storySummary: submission.storySummary,
    proposedHeadline: submission.proposedHeadline,
    publishedHeadline: submission.publishedHeadline || null
  });
  const completion = await client.responses.create({
    model: "gpt-5.6-sol",
    reasoning: { effort: "medium" },
    store: false,
    safety_identifier: digest,
    max_output_tokens: 4000,
    input: [
      { role: "developer", content: [{ type: "input_text", text: assessmentInstructions() }] },
      { role: "user", content: [{ type: "input_text", text: input }] }
    ],
    text: { format: { type: "json_schema", name: "headline_clinic_assessment", strict: true, schema: ASSESSMENT_SCHEMA } }
  });
  if (!completion.output_text) throw new Error("malformed-model-output");
  try { return JSON.parse(completion.output_text); } catch { throw new Error("malformed-model-output"); }
}

function createAssessHeadlineHandler({ getSecrets, createClient, now = () => new Date() }) {
  const dailyCounts = new Map();
  function rateLimitAvailable(digest) {
    const day = utcDay(now); const totalKey = `total:${day}`; const codeKey = `code:${day}:${digest}`;
    const total = dailyCounts.get(totalKey) || 0; const codeTotal = dailyCounts.get(codeKey) || 0;
    return total < TOTAL_DAILY_LIMIT && codeTotal < PER_CODE_DAILY_LIMIT;
  }
  function recordSuccessfulAssessment(digest) {
    const day = utcDay(now); const totalKey = `total:${day}`; const codeKey = `code:${day}:${digest}`;
    dailyCounts.set(totalKey, (dailyCounts.get(totalKey) || 0) + 1);
    dailyCounts.set(codeKey, (dailyCounts.get(codeKey) || 0) + 1);
  }
  async function handler(request, response) {
    if (!setCors(request, response)) return sendJson(response, 403, { error: "This origin is not allowed." });
    if (request.method === "OPTIONS") return response.status(204).send("");
    if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST for headline assessments." });
    const submission = validateSubmission(getJsonBody(request));
    if (typeof submission === "string") return sendJson(response, 400, { error: submission });
    const secrets = getSecrets();
    if (!secrets.openaiApiKey || !secrets.pilotAccessCodes || !secrets.pilotAccessPepper) return sendJson(response, 503, { error: "Headline Clinic is temporarily unavailable." });
    const digest = codeDigest(submission.accessCode, secrets.pilotAccessPepper);
    if (!safelyMatchesPilotCode(digest, secrets.pilotAccessCodes, secrets.pilotAccessPepper)) return sendJson(response, 401, { error: "Invalid or expired pilot access code." });
    if (!rateLimitAvailable(digest)) return sendJson(response, 429, { error: "The pilot request limit has been reached." });
    let result;
    try { result = await requestAssessment(createClient(secrets.openaiApiKey), submission, digest); }
    catch (error) {
      const timeout = error && (error.name === "AbortError" || error.name === "APIConnectionTimeoutError" || error.code === "ETIMEDOUT");
      return sendJson(response, timeout ? 504 : 502, { error: timeout ? "The assessment took too long. Please try again." : "Headline Clinic is temporarily unavailable. Please try again shortly." });
    }
    if (!isValidResult(result, Boolean(submission.publishedHeadline))) return sendJson(response, 502, { error: "Headline Clinic returned an incomplete assessment. Please try again." });
    recordSuccessfulAssessment(digest);
    return sendJson(response, 200, result);
  }
  return { handler, resetState: () => dailyCounts.clear() };
}

const production = createAssessHeadlineHandler({
  getSecrets: () => ({ openaiApiKey: OPENAI_API_KEY.value(), pilotAccessCodes: PILOT_ACCESS_CODES.value(), pilotAccessPepper: PILOT_ACCESS_PEPPER.value() }),
  createClient: (apiKey) => new OpenAI({ apiKey })
});

exports.assessHeadline = onRequest({ cors: false, maxInstances: 1, concurrency: 1, timeoutSeconds: 30, secrets: [OPENAI_API_KEY, PILOT_ACCESS_CODES, PILOT_ACCESS_PEPPER] }, production.handler);
exports.__testables = { createAssessHeadlineHandler, isValidAssessment, isValidResult, codeDigest, ASSESSMENT_SCHEMA };
