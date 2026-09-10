"use strict";

const crypto = require("node:crypto");
const OpenAI = require("openai");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "https://clearcopy.clinic"
]);

const ARTICLE_TYPES = new Set([
  "feature-profile", "news-feature", "explainer", "analysis",
  "opinion-column", "magazine-lifestyle", "newsletter-blog", "other"
]);

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const PILOT_ACCESS_CODES = defineSecret("PILOT_ACCESS_CODES");
const PILOT_ACCESS_PEPPER = defineSecret("PILOT_ACCESS_PEPPER");
const PER_CODE_DAILY_LIMIT = 6;
const TOTAL_DAILY_LIMIT = 35;

const evidence = {
  type: "array", minItems: 0, maxItems: 2,
  items: { type: "string", minLength: 1, maxLength: 280 }
};

const FINDING = {
  type: "object", additionalProperties: false,
  required: ["title", "explanation", "evidence"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    explanation: { type: "string", minLength: 1, maxLength: 650 },
    evidence
  }
};

const PRIORITY = {
  type: "object", additionalProperties: false,
  required: ["title", "whyItMatters", "evidence", "action", "coachingQuestion"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    whyItMatters: { type: "string", minLength: 1, maxLength: 700 },
    evidence,
    action: { type: "string", minLength: 1, maxLength: 450 },
    coachingQuestion: { type: "string", minLength: 1, maxLength: 300 }
  }
};

const FOCUS = {
  type: "object", additionalProperties: false,
  required: ["diagnosis", "evidence", "action", "coachingQuestion"],
  properties: {
    diagnosis: { type: "string", minLength: 1, maxLength: 700 },
    evidence,
    action: { type: "string", minLength: 1, maxLength: 450 },
    coachingQuestion: { type: "string", minLength: 1, maxLength: 300 }
  }
};

const WARNING = {
  type: "object", additionalProperties: false,
  required: ["level", "issue", "action"],
  properties: {
    level: { type: "string", enum: ["Check carefully", "Human review required"] },
    issue: { type: "string", minLength: 1, maxLength: 500 },
    action: { type: "string", minLength: 1, maxLength: 400 }
  }
};

const ASSESSMENT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: [
    "version", "mode", "overview", "strengths", "priorities",
    "openingHeadline", "sourcesEvidenceQuotes", "endingConclusion",
    "copyEdits", "warnings"
  ],
  properties: {
    version: { type: "string", enum: ["article-pilot-v1"] },
    mode: { type: "string", enum: ["coaching"] },
    overview: { type: "string", minLength: 1, maxLength: 1000 },
    strengths: { type: "array", minItems: 1, maxItems: 4, items: FINDING },
    priorities: { type: "array", minItems: 2, maxItems: 5, items: PRIORITY },
    openingHeadline: FOCUS,
    sourcesEvidenceQuotes: FOCUS,
    endingConclusion: FOCUS,
    copyEdits: { type: "array", minItems: 0, maxItems: 8, items: FINDING },
    warnings: { type: "array", minItems: 0, maxItems: 3, items: WARNING }
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

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getJsonBody(request) {
  if (!request.is("application/json")) return null;
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return null; }
  }
  return null;
}

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON submission.";
  const allowed = new Set([
    "accessCode", "articleType", "headline",
    "publicationContext", "assignmentBrief", "articleText"
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return "The submission contains an unsupported field.";

  const submission = {
    accessCode: cleanText(body.accessCode),
    articleType: cleanText(body.articleType),
    headline: cleanText(body.headline),
    publicationContext: cleanText(body.publicationContext),
    assignmentBrief: cleanText(body.assignmentBrief),
    articleText: cleanText(body.articleText)
  };

  if (!/^[A-Za-z0-9-]{8,32}$/.test(submission.accessCode)) return "Enter a valid pilot access code.";
  if (!ARTICLE_TYPES.has(submission.articleType)) return "Choose a valid article type.";
  if (submission.headline.length > 220) return "Keep the headline to 220 characters or fewer.";
  if (submission.publicationContext.length > 220) return "Keep the publication context to 220 characters or fewer.";
  if (submission.assignmentBrief.length > 1500) return "Keep the brief to 1,500 characters or fewer.";
  if (submission.articleText.length < 500) return "Add at least 500 characters of article text.";
  if (submission.articleText.length > 20000) return "Keep the article to 20,000 characters or fewer.";
  return submission;
}

function codeDigest(code, pepper) {
  return crypto.createHmac("sha256", pepper).update(code, "utf8").digest("hex");
}

function pilotCodeLabel(code) {
  const match = /^H674-([A-E])-[A-Z0-9]{6}$/i.exec(code);
  return match ? `H674-${match[1].toUpperCase()}` : "article-pilot";
}

function matchesCode(digest, configuredCodes, pepper) {
  const submitted = Buffer.from(digest, "hex");
  let matched = false;
  for (const code of configuredCodes.split(",").map((x) => x.trim()).filter(Boolean)) {
    const candidate = Buffer.from(codeDigest(code, pepper), "hex");
    matched = crypto.timingSafeEqual(submitted, candidate) || matched;
  }
  return matched;
}

function dayKey(now) {
  return now().toISOString().slice(0, 10);
}

function buildQuickPlan(priorities) {
  return priorities.slice(0, 5).map((priority) => priority.action.trim());
}

function assessmentInstructions() {
  return `You are Article Clinic, an editorial coaching tool for serious article writing.

Assess ONLY the supplied article, article type, headline, audience/publication context and brief. Do not use outside facts, web knowledge or unstated context to confirm or contradict factual claims.

Adapt your judgement to the selected article type. Do not force feature-writing conventions onto explainers, analysis, opinion or other forms where they do not fit.

Your purpose is revision coaching, not grading or ghostwriting. Do not score the article. Do not rewrite the full article. Do not generate a replacement headline in this first response. Do not silently rewrite direct quotations.

Prioritise high-value editorial issues before grammar:
1. central angle, thesis or story proposition;
2. headline/opening alignment;
3. structure and narrative/logical movement;
4. reporting, evidence or explanatory depth;
5. sources, attribution and claims needing verification;
6. quote integrity and quote selection where relevant;
7. showing versus telling where relevant;
8. voice, tone and overwriting;
9. ending or conclusion;
10. specific copy-editing issues.

Identify genuine strengths worth preserving and only the most important revision priorities. Ground findings in short excerpts or precise references to the submitted article. Prefer actions and coaching questions over replacement wording.

Integrity rules:
- If a vivid scene may be reconstructed, do NOT accuse the writer of invention. Ask whether the details were actually observed or properly sourced.
- If a direct quote sounds unusually polished or perfectly thematic, advise checking it against the recording/notes; do not claim fabrication.
- If a source is unnamed without an obvious reason, flag identification/anonymity as a reporting issue.
- If a factual, historical, institutional, political, legal or sporting claim needs checking, say it should be independently verified. Do not fact-check it yourself.
- Use "Human review required" only for serious unresolved allegations, privacy/identification issues, confidential-source concerns, potentially defamatory wording, serious contradictions or comparable professional risks.
- Use "Check carefully" for ordinary but meaningful verification or reporting concerns.
- If a diagnostic area is not very relevant to the selected article type, say so briefly rather than inventing a problem.
- For copy-editing, identify concrete problems from the article rather than generic advice.

Every text field must contain polished final user-facing prose only, with no internal notes, drafting comments, process commentary, schema commentary, chain-of-thought, or unfinished fragments.

Return the required JSON only.`;
}

async function requestAssessment(client, submission, digest) {
  const input = JSON.stringify({
    articleType: submission.articleType,
    headline: submission.headline || null,
    publicationContext: submission.publicationContext || null,
    assignmentBrief: submission.assignmentBrief || null,
    articleText: submission.articleText
  });

  const completion = await client.responses.create({
    model: "gpt-5.6-sol",
    reasoning: { effort: "medium" },
    store: false,
    safety_identifier: digest,
    max_output_tokens: 6500,
    input: [
      { role: "developer", content: [{ type: "input_text", text: assessmentInstructions() }] },
      { role: "user", content: [{ type: "input_text", text: input }] }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "article_clinic_assessment",
        strict: true,
        schema: ASSESSMENT_SCHEMA
      }
    }
  });

  if (!completion.output_text) throw new Error("malformed-model-output");
  try {
    const result = JSON.parse(completion.output_text);
    result.quickPlan = buildQuickPlan(result.priorities);
    return result;
  }
  catch { throw new Error("malformed-model-output"); }
}

function createArticleHandler({ getSecrets, createClient, now = () => new Date(), log = logger }) {
  const counts = new Map();

  function limitAvailable(digest) {
    const day = dayKey(now);
    return (counts.get(`total:${day}`) || 0) < TOTAL_DAILY_LIMIT &&
      (counts.get(`code:${day}:${digest}`) || 0) < PER_CODE_DAILY_LIMIT;
  }

  function record(digest) {
    const day = dayKey(now);
    const total = `total:${day}`;
    const code = `code:${day}:${digest}`;
    counts.set(total, (counts.get(total) || 0) + 1);
    counts.set(code, (counts.get(code) || 0) + 1);
  }

  async function handler(request, response) {
    const startedAt = Date.now();
    if (!setCors(request, response)) return sendJson(response, 403, { error: "This origin is not allowed." });
    if (request.method === "OPTIONS") return response.status(204).send("");
    if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST for article reviews." });

    const submission = validateSubmission(getJsonBody(request));
    if (typeof submission === "string") return sendJson(response, 400, { error: submission });

    const secrets = getSecrets();
    if (!secrets.openaiApiKey || !secrets.pilotAccessCodes || !secrets.pilotAccessPepper) {
      return sendJson(response, 503, { error: "Article Clinic is temporarily unavailable." });
    }

    const digest = codeDigest(submission.accessCode, secrets.pilotAccessPepper);
    if (!matchesCode(digest, secrets.pilotAccessCodes, secrets.pilotAccessPepper)) {
      return sendJson(response, 401, { error: "Invalid or expired pilot access code." });
    }
    if (!limitAvailable(digest)) return sendJson(response, 429, { error: "The pilot request limit has been reached." });

    let result;
    try {
      result = await requestAssessment(createClient(secrets.openaiApiKey), submission, digest);
    } catch (error) {
      const timeout = error && (
        error.name === "AbortError" ||
        error.name === "APIConnectionTimeoutError" ||
        error.code === "ETIMEDOUT"
      );
      return sendJson(response, timeout ? 504 : 502, {
        error: timeout ? "The review took too long. Please try again." : "Article Clinic is temporarily unavailable."
      });
    }

    record(digest);
    log.info({
      event: "article_clinic_success",
      codeId: pilotCodeLabel(submission.accessCode),
      durationMs: Date.now() - startedAt
    });
    return sendJson(response, 200, result);
  }

  return { handler, resetState: () => counts.clear() };
}

const production = createArticleHandler({
  getSecrets: () => ({
    openaiApiKey: OPENAI_API_KEY.value(),
    pilotAccessCodes: PILOT_ACCESS_CODES.value(),
    pilotAccessPepper: PILOT_ACCESS_PEPPER.value()
  }),
  createClient: (apiKey) => new OpenAI({ apiKey })
});

exports.assessArticle = onRequest({
  cors: false,
  maxInstances: 1,
  concurrency: 5,
  timeoutSeconds: 120,
  secrets: [OPENAI_API_KEY, PILOT_ACCESS_CODES, PILOT_ACCESS_PEPPER]
}, production.handler);

exports.__testables = { validateSubmission, createArticleHandler, ASSESSMENT_SCHEMA, buildQuickPlan };
