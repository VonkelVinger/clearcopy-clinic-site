"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { __testables } = require("../index.js");

const validBody = {
  accessCode: "PILOT-DEMO-01",
  storyType: "hard-news",
  storySummary: "A council committee has recommended a library closure, but the full council has not yet voted. Residents are petitioning against the proposal.",
  proposedHeadline: "Council closes two libraries",
  publishedHeadline: "Committee proposes library closures"
};

function request({ method = "POST", origin = "http://127.0.0.1:8080", body = validBody, headers = {} } = {}) {
  return {
    method,
    body,
    is: (type) => type === "application/json",
    get: (name) => ({ origin, ...headers }[name.toLowerCase()])
  };
}

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }
  };
}

async function invoke(options) {
  const res = response();
  await __testables.assessHeadlineHandler(request(options), res);
  return res;
}

test.beforeEach(() => __testables.resetMockState());

test("returns a six-category coaching assessment without a replacement headline", async () => {
  const res = await invoke({ body: { ...validBody, publishedHeadline: "" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentAssessment.categories.length, 6);
  assert.equal(res.body.publishedAssessment, null);
  assert.equal(JSON.stringify(res.body).includes("replacementHeadline"), false);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("assesses an optional published headline independently", async () => {
  const res = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.publishedAssessment.categories.length, 6);
  assert.notEqual(res.body.studentAssessment, res.body.publishedAssessment);
});

test("rejects an invalid access code", async () => {
  const res = await invoke({ body: { ...validBody, accessCode: "INVALID-01" } });
  assert.equal(res.statusCode, 401);
});

test("rejects missing or short story text", async () => {
  const res = await invoke({ body: { ...validBody, storySummary: "Too short" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /80 characters/);
});

test("rejects an invalid headline", async () => {
  const res = await invoke({ body: { ...validBody, proposedHeadline: "No" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /5 and 140/);
});

test("returns the mock rate-limit fixture", async () => {
  const res = await invoke({ headers: { "x-headline-clinic-mock": "rate-limit" } });
  assert.equal(res.statusCode, 429);
});

test("returns the malformed-response fixture", async () => {
  const res = await invoke({ headers: { "x-headline-clinic-mock": "malformed" } });
  assert.equal(res.statusCode, 200);
  assert.equal(__testables.isValidAssessment(res.body.studentAssessment), false);
});

test("returns the timeout fixture", async () => {
  const res = await invoke({ headers: { "x-headline-clinic-mock": "timeout" } });
  assert.equal(res.statusCode, 504);
});

test("rejects unsupported origins, methods, and fields", async () => {
  const originRes = await invoke({ origin: "https://example.test" });
  assert.equal(originRes.statusCode, 403);
  const methodRes = await invoke({ method: "GET" });
  assert.equal(methodRes.statusCode, 405);
  const fieldRes = await invoke({ body: { ...validBody, unexpected: true } });
  assert.equal(fieldRes.statusCode, 400);
});
