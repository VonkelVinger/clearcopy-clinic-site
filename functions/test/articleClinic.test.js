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
      createClient: () => ({ responses: { create: async (payload) => {
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
