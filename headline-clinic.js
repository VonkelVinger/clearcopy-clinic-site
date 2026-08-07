(() => {
  "use strict";

  const API_URL = "https://us-central1-clear-copy-clinic.cloudfunctions.net/assessHeadline";
  const REQUEST_TIMEOUT_MS = 25_000;
  const CATEGORIES = ["Accuracy", "Clarity", "Specificity", "News value", "Style", "Fairness and risk"];
  const RATINGS = new Set(["Strong", "Needs attention", "Serious problem"]);

  const form = document.getElementById("headline-form");
  const button = document.getElementById("check-headline-button");
  const formError = document.getElementById("form-error");
  const formStatus = document.getElementById("form-status");
  const feedbackPanel = document.getElementById("feedback-panel");
  const feedbackIntro = document.getElementById("feedback-intro");
  const feedbackList = document.getElementById("feedback-list");
  const emptyState = document.getElementById("feedback-empty-state");
  let isSubmitting = false;

  function setMessage(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  function clearFieldErrors() {
    form.querySelectorAll(".field-error").forEach((error) => {
      error.textContent = "";
      error.hidden = true;
    });
    form.querySelectorAll(".has-error").forEach((field) => {
      field.classList.remove("has-error");
      field.removeAttribute("aria-invalid");
    });
  }

  function addFieldError(field, message) {
    const error = document.getElementById(`${field.id}-error`);
    field.classList.add("has-error");
    field.setAttribute("aria-invalid", "true");
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function validate(values) {
    const errors = [];
    if (!/^[A-Za-z0-9-]{8,32}$/.test(values.accessCode)) {
      errors.push(["pilot-access-code", "Enter the 8–32 character pilot access code you received."]);
    }
    if (!values.storyType) errors.push(["story-type", "Choose the story type."]);
    if (values.storySummary.length < 80) errors.push(["story-summary", "Add at least 80 characters of story context."]);
    if (values.storySummary.length > 4000) errors.push(["story-summary", "Keep the story context to 4,000 characters or fewer."]);
    if (values.proposedHeadline.length < 5 || values.proposedHeadline.length > 140) {
      errors.push(["proposed-headline", "Enter a headline between 5 and 140 characters."]);
    }
    if (values.publishedHeadline.length > 140) {
      errors.push(["published-headline", "Keep the published headline to 140 characters or fewer."]);
    }
    return errors;
  }

  function readValues() {
    return {
      accessCode: document.getElementById("pilot-access-code").value.trim(),
      storyType: document.getElementById("story-type").value,
      storySummary: document.getElementById("story-summary").value.trim(),
      proposedHeadline: document.getElementById("proposed-headline").value.trim(),
      publishedHeadline: document.getElementById("published-headline").value.trim()
    };
  }

  function isValidAssessment(assessment) {
    return assessment && Array.isArray(assessment.categories) && assessment.categories.length === 6 &&
      assessment.categories.every((item, index) => item.category === CATEGORIES[index] && RATINGS.has(item.rating) &&
        typeof item.diagnosis === "string" && Array.isArray(item.coachingQuestions));
  }

  function renderAssessment(assessment, heading) {
    const section = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = heading;
    section.appendChild(title);

    const summary = document.createElement("p");
    summary.textContent = `${assessment.overallRating}: ${assessment.summary}`;
    section.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "feedback-list";
    assessment.categories.forEach((item) => {
      const row = document.createElement("li");
      row.className = "feedback-item";
      const category = document.createElement("h3");
      category.textContent = `${item.category}: ${item.rating}`;
      const diagnosis = document.createElement("p");
      diagnosis.textContent = item.diagnosis;
      row.append(category, diagnosis);
      if (Array.isArray(item.storyEvidence) && item.storyEvidence.length) {
        const evidence = document.createElement("section");
        evidence.className = "story-evidence";
        const evidenceHeading = document.createElement("h4");
        evidenceHeading.textContent = "Evidence from your story";
        const evidenceList = document.createElement("ul");
        item.storyEvidence.forEach((evidenceText) => {
          const evidenceItem = document.createElement("li");
          evidenceItem.textContent = evidenceText;
          evidenceList.appendChild(evidenceItem);
        });
        evidence.append(evidenceHeading, evidenceList);
        row.appendChild(evidence);
      }
      if (item.coachingQuestions.length) {
        const question = document.createElement("p");
        question.textContent = item.coachingQuestions.join(" ");
        row.appendChild(question);
      }
      if (item.seriousWarning) {
        const warning = document.createElement("section");
        warning.className = "human-review-callout";
        warning.setAttribute("role", "note");
        warning.setAttribute("aria-label", "Human review required");
        const warningHeading = document.createElement("h4");
        warningHeading.textContent = "Human review required";
        const warningText = document.createElement("p");
        warningText.textContent = item.seriousWarning;
        warning.append(warningHeading, warningText);
        row.appendChild(warning);
      }
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  function renderFeedback(data) {
    if (!isValidAssessment(data.studentAssessment) || (data.publishedAssessment && !isValidAssessment(data.publishedAssessment))) {
      throw new Error("invalid-response");
    }
    feedbackList.replaceChildren();
    feedbackList.appendChild(renderAssessment(data.studentAssessment, "Your proposed headline"));
    if (data.publishedAssessment) feedbackList.appendChild(renderAssessment(data.publishedAssessment, "Published headline comparison"));
    if (data.nextStep) {
      const nextStep = document.createElement("section");
      nextStep.className = "next-step";
      const nextStepHeading = document.createElement("h3");
      nextStepHeading.textContent = "Your next step";
      const nextStepText = document.createElement("p");
      nextStepText.textContent = data.nextStep;
      nextStep.append(nextStepHeading, nextStepText);
      feedbackList.appendChild(nextStep);
    }
    feedbackIntro.textContent = "Your feedback is organised around the six Headline Clinic review categories.";
    emptyState.hidden = true;
  }

  async function submit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    clearFieldErrors();
    setMessage(formError, "");
    setMessage(formStatus, "");
    const values = readValues();
    const errors = validate(values);
    if (errors.length) {
      errors.forEach(([id, message]) => addFieldError(document.getElementById(id), message));
      setMessage(formError, "Please correct the highlighted fields before checking your headline.");
      document.getElementById(errors[0][0]).focus();
      return;
    }

    isSubmitting = true;
    button.disabled = true;
    button.textContent = "Checking…";
    feedbackPanel.setAttribute("aria-busy", "true");
    setMessage(formStatus, "Checking your headline. Please wait.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let completed = false;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const messages = {
          400: "Please check your story and headline details, then try again.",
          401: "That pilot access code is invalid or has expired.",
          413: "Your story is too long for this pilot. Please shorten it and try again.",
          429: "This pilot access code has reached its current request limit. Please try again later.",
          504: "The check took too long. No submission was saved; please try again."
        };
        throw new Error(messages[response.status] || "Headline Clinic is temporarily unavailable. Please try again shortly.");
      }
      renderFeedback(body);
      setMessage(formStatus, "Feedback is ready. Review the coaching questions before revising your headline.");
      completed = true;
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The check took too long. No submission was saved; please try again."
        : error.message === "invalid-response"
          ? "Headline Clinic returned an incomplete assessment. Please try again."
          : error.message;
      setMessage(formError, message || "Headline Clinic is temporarily unavailable. Please try again shortly.");
      setMessage(formStatus, "");
    } finally {
      window.clearTimeout(timeout);
      isSubmitting = false;
      button.disabled = false;
      button.textContent = "Check my headline";
      feedbackPanel.setAttribute("aria-busy", "false");
      if (!completed) setMessage(formStatus, "");
    }
  }

  form.addEventListener("submit", submit);
})();
