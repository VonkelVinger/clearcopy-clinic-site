(() => {
  "use strict";

  const API_URL = "https://us-central1-clear-copy-clinic.cloudfunctions.net/assessArticle";
  const REQUEST_TIMEOUT_MS = 65000;

  const form = document.getElementById("article-form");
  const button = document.getElementById("review-button");
  const formError = document.getElementById("form-error");
  const formStatus = document.getElementById("form-status");
  const feedbackPanel = document.getElementById("feedback-panel");
  const feedbackIntro = document.getElementById("feedback-intro");
  const feedbackContent = document.getElementById("feedback-content");
  const emptyState = document.getElementById("feedback-empty");
  const articleText = document.getElementById("article-text");
  const wordCount = document.getElementById("word-count");
  let isSubmitting = false;

  const setMessage = (el, text) => { el.textContent = text; el.hidden = !text; };
  const words = (text) => text.trim() ? text.trim().split(/\s+/).length : 0;
  const updateCount = () => {
    const count = words(articleText.value);
    wordCount.textContent = `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
  };

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; el.hidden = true; });
    form.querySelectorAll(".has-error").forEach((el) => {
      el.classList.remove("has-error"); el.removeAttribute("aria-invalid");
    });
  }

  function addError(id, message) {
    const field = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);
    field.classList.add("has-error"); field.setAttribute("aria-invalid", "true");
    if (error) { error.textContent = message; error.hidden = false; }
  }

  function readValues() {
    return {
      accessCode: document.getElementById("pilot-access-code").value.trim(),
      articleType: document.getElementById("article-type").value,
      headline: document.getElementById("headline").value.trim(),
      publicationContext: document.getElementById("publication-context").value.trim(),
      assignmentBrief: document.getElementById("assignment-brief").value.trim(),
      articleText: articleText.value.trim()
    };
  }

  function validate(v) {
    const errors = [];
    if (!/^[A-Za-z0-9-]{8,32}$/.test(v.accessCode)) errors.push(["pilot-access-code", "Enter the pilot access code you received."]);
    if (!v.articleType) errors.push(["article-type", "Choose the closest article type."]);
    if (v.headline.length > 220) errors.push(["headline", "Keep the headline to 220 characters or fewer."]);
    if (v.publicationContext.length > 220) errors.push(["publication-context", "Keep this to 220 characters or fewer."]);
    if (v.assignmentBrief.length > 1500) errors.push(["assignment-brief", "Keep the brief to 1,500 characters or fewer."]);
    if (v.articleText.length < 500) errors.push(["article-text", "Add at least 500 characters of article text."]);
    if (v.articleText.length > 20000) errors.push(["article-text", "Keep the article to 20,000 characters or fewer."]);
    return errors;
  }

  function section(title) {
    const node = document.createElement("section");
    node.className = "feedback-section";
    const h = document.createElement("h3"); h.textContent = title; node.appendChild(h);
    return node;
  }

  function finding(item, index) {
    const row = document.createElement("li"); row.className = "feedback-item";
    const h = document.createElement("h4"); h.textContent = item.title || `Point ${index + 1}`; row.appendChild(h);
    const body = document.createElement("p");
    body.textContent = item.explanation || item.whyItMatters || item.diagnosis || "";
    row.appendChild(body);
    if (item.evidence?.length) {
      const e = document.createElement("div"); e.className = "evidence";
      e.textContent = item.evidence.join(" · "); row.appendChild(e);
    }
    if (item.action) {
      const p = document.createElement("p"); p.textContent = `Action: ${item.action}`; row.appendChild(p);
    }
    if (item.coachingQuestion) {
      const p = document.createElement("p"); p.textContent = `Question: ${item.coachingQuestion}`; row.appendChild(p);
    }
    return row;
  }

  function listSection(title, items) {
    const node = section(title); const list = document.createElement("ul"); list.className = "feedback-list";
    items.forEach((item, i) => list.appendChild(finding(item, i))); node.appendChild(list); return node;
  }

  function focusSection(title, item) {
    const node = section(title); const list = document.createElement("ul"); list.className = "feedback-list";
    list.appendChild(finding({ title, ...item }, 0)); node.appendChild(list); return node;
  }

  function render(data) {
    feedbackContent.replaceChildren();
    const overview = section("Overall diagnosis");
    const p = document.createElement("p"); p.textContent = data.overview; overview.appendChild(p);
    feedbackContent.append(
      overview,
      listSection("What is already working", data.strengths),
      listSection("Your biggest revision priorities", data.priorities),
      focusSection("Headline and opening", data.openingHeadline),
      focusSection("Sources, evidence and quotations", data.sourcesEvidenceQuotes),
      focusSection("Ending or conclusion", data.endingConclusion)
    );
    if (data.copyEdits.length) feedbackContent.appendChild(listSection("Specific editing and proofreading points", data.copyEdits));

    const quick = section("If you only have 15 minutes");
    const ol = document.createElement("ol");
    data.quickPlan.forEach((item) => { const li = document.createElement("li"); li.textContent = item; ol.appendChild(li); });
    quick.appendChild(ol); feedbackContent.appendChild(quick);

    if (data.warnings.length) {
      const warnings = section("Checks before you resubmit");
      data.warnings.forEach((item) => {
        const box = document.createElement("div"); box.className = "warning";
        const strong = document.createElement("strong"); strong.textContent = item.level;
        const text = document.createElement("p"); text.textContent = `${item.issue} ${item.action}`;
        box.append(strong, text); warnings.appendChild(box);
      });
      feedbackContent.appendChild(warnings);
    }
    feedbackIntro.textContent = "The Clinic has prioritised the changes most likely to improve this draft.";
    emptyState.hidden = true;
  }

  async function submit(event) {
    event.preventDefault(); if (isSubmitting) return;
    clearErrors(); setMessage(formError, ""); setMessage(formStatus, "");
    const values = readValues(); const errors = validate(values);
    if (errors.length) {
      errors.forEach(([id, message]) => addError(id, message));
      setMessage(formError, "Please correct the highlighted fields before submitting.");
      document.getElementById(errors[0][0]).focus(); return;
    }

    isSubmitting = true; button.disabled = true; button.textContent = "Reviewing…";
    feedbackPanel.setAttribute("aria-busy", "true");
    setMessage(formStatus, "Reviewing your article. This can take a little while.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values), signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const messages = {
          400: "Please check the information you supplied and try again.",
          401: "That pilot access code is invalid or has expired.",
          413: "Your article is too long for this pilot.",
          429: "This pilot access code has reached its current request limit.",
          504: "The review took too long. No submission was saved; please try again."
        };
        throw new Error(messages[response.status] || "Article Clinic is temporarily unavailable.");
      }
      render(body);
      setMessage(formStatus, "Your coaching notes are ready. Revise the article yourself before running it again.");
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The review took too long. No submission was saved; please try again."
        : error.message;
      setMessage(formError, message || "Article Clinic is temporarily unavailable.");
      setMessage(formStatus, "");
    } finally {
      window.clearTimeout(timeout); isSubmitting = false; button.disabled = false;
      button.textContent = "Review my article"; feedbackPanel.setAttribute("aria-busy", "false");
    }
  }

  articleText.addEventListener("input", updateCount);
  form.addEventListener("submit", submit);
  updateCount();
})();
