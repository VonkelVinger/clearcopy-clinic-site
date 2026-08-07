"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { __testables } = require("../index.js");

const validBody = {
  accessCode: "PILOT-DEMO-01", storyType: "hard-news",
  storySummary: "A council committee has recommended closing two public libraries because of budget pressures. The full council will vote on the proposal next month. Residents have started a petition opposing the closures.",
  proposedHeadline: "City closes libraries", publishedHeadline: "Committee recommends library closures"
};
function category(category, rating = "Strong") { return { category, rating, storyEvidence: ["The supplied story supports this finding."], diagnosis: "A concise diagnosis based on the supplied story.", coachingQuestions: ["What wording best preserves the story's level of certainty?"], seriousWarning: null }; }
function fixture({ published = true, council = false } = {}) {
  const student = ["Accuracy", "Clarity", "Specificity", "News value", "Style", "Fairness and risk"].map((name) => category(name));
  if (council) { student[0] = { ...category("Accuracy", "Serious problem"), storyEvidence: ["The committee recommended closures, but the full council will vote next month."], diagnosis: "The headline says closures have happened although the decision is still pending.", seriousWarning: "Do not publish this as a completed closure." }; }
  return { version: "pilot-v1", mode: "live", studentAssessment: { overallRating: council ? "Serious problem" : "Strong", summary: "Feedback is based only on the supplied story.", categories: student }, publishedAssessment: published ? { overallRating: "Strong", summary: "This headline is assessed independently.", categories: ["Accuracy", "Clarity", "Specificity", "News value", "Style", "Fairness and risk"].map((name) => category(name)) } : null, nextStep: "Revise your own headline using the coaching questions." };
}
function request({ method = "POST", origin = "http://127.0.0.1:8080", body = validBody, headers = {} } = {}) { return { method, body, is: (type) => type === "application/json", get: (name) => ({ origin, ...headers }[name.toLowerCase()]) }; }
function response() { return { headers: {}, statusCode: null, body: null, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } }; }
function setup(output = fixture()) {
  const calls = [];
  const service = __testables.createAssessHeadlineHandler({ getSecrets: () => ({ openaiApiKey: "test-key", pilotAccessCodes: "PILOT-DEMO-01,SECOND-CODE", pilotAccessPepper: "test-pepper" }), createClient: () => ({ responses: { create: async (payload) => { calls.push(payload); return output instanceof Error ? Promise.reject(output) : { output_text: JSON.stringify(output) }; } } }) });
  return { service, calls };
}
async function invoke(service, options) { const res = response(); await service.handler(request(options), res); return res; }

test("returns a live-shaped six-category assessment without a replacement headline", async () => { const { service, calls } = setup(fixture({ published: false })); const res = await invoke(service, { body: { ...validBody, publishedHeadline: "" } }); assert.equal(res.statusCode, 200); assert.equal(res.body.mode, "live"); assert.equal(res.body.studentAssessment.categories.length, 6); assert.equal(res.body.publishedAssessment, null); assert.equal(JSON.stringify(res.body).includes("replacementHeadline"), false); assert.equal(res.headers["Cache-Control"], "no-store"); assert.equal(calls[0].model, "gpt-5.6-sol"); assert.equal(calls[0].store, false); });
test("assesses an optional published headline independently", async () => { const { service } = setup(); const res = await invoke(service); assert.equal(res.statusCode, 200); assert.equal(res.body.publishedAssessment.categories.length, 6); assert.notEqual(res.body.studentAssessment, res.body.publishedAssessment); });
test("returns a Serious problem accuracy calibration for the council proposal", async () => { const { service } = setup(fixture({ council: true })); const res = await invoke(service); assert.equal(res.statusCode, 200); assert.equal(res.body.studentAssessment.categories[0].rating, "Serious problem"); });
test("rejects invalid access codes and invalid input", async () => { let setupResult = setup(); let res = await invoke(setupResult.service, { body: { ...validBody, accessCode: "INVALID-01" } }); assert.equal(res.statusCode, 401); res = await invoke(setupResult.service, { body: { ...validBody, storySummary: "Too short" } }); assert.equal(res.statusCode, 400); res = await invoke(setupResult.service, { body: { ...validBody, proposedHeadline: "No" } }); assert.equal(res.statusCode, 400); });
test("limits successful assessments without using a raw code as a key", async () => { const { service } = setup(); assert.equal((await invoke(service)).statusCode, 200); assert.equal((await invoke(service)).statusCode, 200); assert.equal((await invoke(service)).statusCode, 429); });
test("handles malformed model results and upstream timeout/failure", async () => { let setupResult = setup({ bad: true }); let res = await invoke(setupResult.service); assert.equal(res.statusCode, 502); setupResult = setup(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })); res = await invoke(setupResult.service); assert.equal(res.statusCode, 504); setupResult = setup(new Error("upstream")); res = await invoke(setupResult.service); assert.equal(res.statusCode, 502); });
test("rejects unsupported origins, methods, and fields", async () => { const { service } = setup(); assert.equal((await invoke(service, { origin: "https://example.test" })).statusCode, 403); assert.equal((await invoke(service, { method: "GET" })).statusCode, 405); assert.equal((await invoke(service, { body: { ...validBody, unexpected: true } })).statusCode, 400); });
