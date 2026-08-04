"use strict";

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "https://clearcopy.clinic"
]);
const STORY_TYPES = new Set(["hard-news", "feature", "opinion", "community-journalism", "digital-social"]);
const CATEGORIES = ["Accuracy", "Clarity", "Specificity", "News value", "Style", "Fairness and risk"];
const RATINGS = new Set(["Strong", "Needs attention", "Serious problem"]);
const MOCK_ACCESS_CODES = new Set(["PILOT-DEMO-01"]);
const PER_CODE_DAILY_LIMIT = 2;
const TOTAL_DAILY_LIMIT = 10;
const dailyCounts = new Map();

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
  response.set("Access-Control-Allow-Headers", "Content-Type, X-Headline-Clinic-Mock");
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

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON submission.";
  const allowedKeys = new Set(["accessCode", "storyType", "storySummary", "proposedHeadline", "publishedHeadline"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return "The submission contains an unsupported field.";

  const accessCode = cleanText(body.accessCode);
  const storyType = cleanText(body.storyType);
  const storySummary = cleanText(body.storySummary);
  const proposedHeadline = cleanText(body.proposedHeadline);
  const publishedHeadline = cleanText(body.publishedHeadline);

  if (!/^[A-Za-z0-9-]{8,32}$/.test(accessCode)) return "Enter a valid pilot access code.";
  if (!STORY_TYPES.has(storyType)) return "Choose a valid story type.";
  if (storySummary.length < 80) return "Add at least 80 characters of story context.";
  if (storySummary.length > 4000) return "Keep the story context to 4,000 characters or fewer.";
  if (proposedHeadline.length < 5 || proposedHeadline.length > 140) return "Enter a headline between 5 and 140 characters.";
  if (publishedHeadline.length > 140) return "Keep the published headline to 140 characters or fewer.";
  return { accessCode, storyType, storySummary, proposedHeadline, publishedHeadline };
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function rateLimitStatus(accessCode) {
  const day = utcDay();
  const totalKey = `total:${day}`;
  const codeKey = `code:${day}:${accessCode}`;
  const total = dailyCounts.get(totalKey) || 0;
  const codeTotal = dailyCounts.get(codeKey) || 0;
  if (total >= TOTAL_DAILY_LIMIT || codeTotal >= PER_CODE_DAILY_LIMIT) return false;
  dailyCounts.set(totalKey, total + 1);
  dailyCounts.set(codeKey, codeTotal + 1);
  return true;
}

function category(category, rating, diagnosis, question, seriousWarning = null) {
  return {
    category,
    rating,
    storyEvidence: ["Review the pasted story for the wording and level of certainty that support this point."],
    diagnosis,
    coachingQuestions: [question],
    seriousWarning
  };
}

function buildMockAssessment(subject) {
  const label = subject === "published" ? "published headline" : "proposed headline";
  return {
    overallRating: "Needs attention",
    summary: `This fictional mock assessment reviews the ${label} without generating a replacement.`,
    categories: [
      category("Accuracy", "Needs attention", `Check whether the ${label} matches the story's confirmed facts and level of certainty.`, "Which words in the story support the headline's main claim?"),
      category("Clarity", "Strong", `The ${label} can be reviewed for whether its main point is understandable on first reading.`, "Can a reader identify the subject and action without opening the story?"),
      category("Specificity", "Needs attention", `Check whether the ${label} names the most useful verified subject, action, or outcome.`, "Which specific detail from the story would help readers understand this headline?"),
      category("News value", "Strong", `The ${label} should lead with the story's most relevant verified development.`, "What is new or consequential in the story?"),
      category("Style", "Needs attention", `Check whether the ${label} fits the selected story type without relying on clickbait or unexplained jargon.`, "Does this wording suit the selected story type and audience?"),
      category("Fairness and risk", "Serious problem", `Treat allegations, disputes, and unresolved claims cautiously in the ${label}.`, "Does the story require attribution or a clearer indication that a claim is unresolved?", "Do not present an allegation as an established fact.")
    ]
  };
}

function mockResponse(submission) {
  return {
    version: "mock-v1",
    mode: "local-mock",
    studentAssessment: buildMockAssessment("student"),
    publishedAssessment: submission.publishedHeadline ? buildMockAssessment("published") : null,
    nextStep: "Revise your own headline using the coaching questions. This first response does not generate a replacement headline."
  };
}

function isValidAssessment(assessment) {
  return assessment && RATINGS.has(assessment.overallRating) && Array.isArray(assessment.categories) &&
    assessment.categories.length === 6 && assessment.categories.every((item, index) =>
      item.category === CATEGORIES[index] && RATINGS.has(item.rating) && typeof item.diagnosis === "string" &&
      Array.isArray(item.storyEvidence) && Array.isArray(item.coachingQuestions) && !Object.hasOwn(item, "replacementHeadline"));
}

async function assessHeadlineHandler(request, response) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: "This origin is not allowed." });
  if (request.method === "OPTIONS") return response.status(204).send("");
  if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST for headline assessments." });

  const submission = validateSubmission(getJsonBody(request));
  if (typeof submission === "string") return sendJson(response, 400, { error: submission });
  if (!MOCK_ACCESS_CODES.has(submission.accessCode)) return sendJson(response, 401, { error: "Invalid or expired pilot access code." });

  const scenario = request.get("x-headline-clinic-mock");
  if (scenario === "rate-limit") return sendJson(response, 429, { error: "The pilot request limit has been reached." });
  if (scenario === "timeout") return sendJson(response, 504, { error: "The mock assessment timed out." });
  if (scenario === "malformed") return sendJson(response, 200, { version: "mock-v1", studentAssessment: {} });
  if (!rateLimitStatus(submission.accessCode)) return sendJson(response, 429, { error: "The pilot request limit has been reached." });

  const result = mockResponse(submission);
  if (!isValidAssessment(result.studentAssessment) || (result.publishedAssessment && !isValidAssessment(result.publishedAssessment))) {
    return sendJson(response, 502, { error: "The mock assessment did not meet the required structure." });
  }
  return sendJson(response, 200, result);
}

function resetMockState() {
  dailyCounts.clear();
}

let onRequest;
try {
  ({ onRequest } = require("firebase-functions/v2/https"));
} catch {
  onRequest = (_options, handler) => handler;
}

exports.assessHeadline = onRequest(
  { cors: false, maxInstances: 1, concurrency: 1, timeoutSeconds: 30 },
  assessHeadlineHandler
);
exports.__testables = { assessHeadlineHandler, buildMockAssessment, isValidAssessment, resetMockState };
