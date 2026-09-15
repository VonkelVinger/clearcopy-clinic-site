"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildQuickPlan, createArticleHandler } = require("../article-clinic.js").__testables;

test("buildQuickPlan trims priority actions in order and limits the plan to five items", () => {
  const priorities = Array.from({ length: 6 }, (_, index) => ({ action: `  Action ${index + 1}.\n` }));
  assert.deepEqual(buildQuickPlan(priorities), ["Action 1.", "Action 2.", "Action 3.", "Action 4.", "Action 5."]);
});

test("returned quickPlan comes from priority actions, not independently generated text", async () => {
  for (const quickPlan of [undefined, ["Independently generated text."]]) {
    const service = createArticleHandler({
      getSecrets: () => ({
        openaiApiKey: "test-key", pilotAccessCodes: "TEST-CODE", pilotAccessPepper: "test-pepper"
      }),
      createClient: () => ({ responses: { create: async (payload, options) => {
        assert.deepEqual(options, { timeout: 165000, maxRetries: 0 });
        const schema = payload.text.format.schema;
        assert.equal(schema.required.includes("quickPlan"), false);
        assert.equal(Object.hasOwn(schema.properties, "quickPlan"), false);
        return { output_text: JSON.stringify({
          priorities: [{ action: "  Clarify the central angle. " }, { action: "Check the source attribution.\n" }],
          quickPlan
        }) };
      } } }),
      log: { info() {} }
    });
    const request = {
      method: "POST",
      get: (name) => name === "origin" ? "http://127.0.0.1:8080" : undefined,
      is: (type) => type === "application/json",
      body: { accessCode: "TEST-CODE", articleType: "analysis", articleText: "Article text. ".repeat(50) }
    };
    const response = {
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };

    await service.handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.quickPlan, ["Clarify the central angle.", "Check the source attribution."]);
  }
});

test("model failures return controlled errors and log only safe metadata", async () => {
  const OpenAI = require("openai");
  const cases = [
    [new OpenAI.APIConnectionTimeoutError(), true],
    [Object.assign(new Error("private content"), { name: "AbortError" }), true],
    [Object.assign(new Error("private content"), { code: "ETIMEDOUT" }), true],
    [Object.assign(new Error("private content"), { name: "RateLimitError", status: 429 }), false],
    [Object.assign(new Error("private content"), { name: "private content", status: "private content" }), false]
  ];
  for (const [error, timeout] of cases) {
    error.body = { articleText: "private content", accessCode: "TEST-CODE" };
    error.type = "private content";
    const logs = [];
    const service = createArticleHandler({
      getSecrets: () => ({ openaiApiKey: "test-key", pilotAccessCodes: "TEST-CODE", pilotAccessPepper: "test-pepper" }),
      createClient: () => ({ responses: { create: async () => { throw error; } } }),
      log: { error: (entry) => logs.push(entry), info() { assert.fail("Failure logged as success"); } }
    });
    const headers = {};
    const response = {
      set(name, value) { headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    const request = {
      method: "POST", get: () => "https://www.clearcopy.clinic", is: () => true,
      body: { accessCode: "TEST-CODE", articleType: "analysis", articleText: "Article text. ".repeat(50) }
    };
    // Failures must not consume the six-success daily allowance.
    for (let attempt = 0; attempt < 7; attempt++) {
      await service.handler(request, response);
      assert.equal(response.statusCode, timeout ? 504 : 502);
    }
    assert.equal(headers["Access-Control-Allow-Origin"], "https://www.clearcopy.clinic");
    assert.equal(response.body.error, timeout ? "The review took too long. Please try again." : "Article Clinic is temporarily unavailable.");
    assert.equal(logs.length, 7);
    for (const entry of logs) {
      assert.deepEqual(Object.keys(entry).sort(), ["durationMs", "errorName", "event", "status", "timeout"]);
      assert.equal(entry.event, "article_clinic_failure");
      assert.equal(entry.timeout, timeout);
      assert.ok(entry.durationMs >= 0);
      assert.equal(entry.status, error.status === 429 ? 429 : null);
      assert.equal(JSON.stringify(entry).includes("private content"), false);
      assert.equal(JSON.stringify(entry).includes("TEST-CODE"), false);
    }
  }
});

test("browser handles fetch failures, aborts and HTTP 504 without exposing raw errors", async () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../../article-clinic.js"), "utf8");
  const timeoutMessage = "The review took too long. No submission was saved; please try again.";
  for (const [failure, expected] of [
    [new TypeError("Failed to fetch"), "Article Clinic could not complete this review. Please try again."],
    [new TypeError("NetworkError when attempting to fetch resource."), "Article Clinic could not complete this review. Please try again."],
    [Object.assign(new Error(), { name: "AbortError" }), timeoutMessage],
    [504, timeoutMessage],
    [401, "That pilot access code is invalid or has expired."]
  ]) {
    const nodes = new Map();
    const getElementById = (id) => {
      if (!nodes.has(id)) nodes.set(id, {
        value: "", textContent: "", hidden: false,
        classList: { remove() {} }, setAttribute() {}, replaceChildren() {},
        querySelectorAll: () => [], addEventListener(event, fn) { this[event] = fn; },
        selectedOptions: [{ textContent: "Analysis" }]
      });
      return nodes.get(id);
    };
    getElementById("pilot-access-code").value = "TEST-CODE";
    getElementById("article-type").value = "analysis";
    getElementById("article-text").value = "Article text. ".repeat(50);
    let deadline;
    vm.runInNewContext(source, {
      document: { getElementById }, performance: { now: () => 0 }, AbortController,
      window: {
        clearInterval() {}, clearTimeout() {}, setInterval() {},
        setTimeout(fn, ms) { deadline = ms; }
      },
      fetch: async () => {
        if (typeof failure !== "number") throw failure;
        return { ok: false, status: failure, json: async () => ({}) };
      }
    });
    await getElementById("article-form").submit({ preventDefault() {} });
    assert.equal(deadline, 190000);
    assert.equal(getElementById("form-error").textContent, expected);
    assert.equal(getElementById("review-button").disabled, false);
    assert.equal(getElementById("feedback-panel").hidden, false);
    assert.equal(getElementById("review-elapsed").hidden, true);
  }
});
