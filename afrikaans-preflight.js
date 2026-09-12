"use strict";

const ENDPOINT = "https://us-central1-clear-copy-clinic.cloudfunctions.net/afrikaansPreflight";
const form = document.getElementById("preflight-form");
const accessInput = document.getElementById("access-code");
const fileInput = document.getElementById("docx-file");
const submitButton = document.getElementById("run-preflight");
const statusBox = document.getElementById("form-status");
const errorBox = document.getElementById("form-error");
const resultCard = document.getElementById("result-card");
const summary = document.getElementById("result-summary");
const flags = document.getElementById("flag-list");
const downloadDocx = document.getElementById("download-docx");
const downloadReport = document.getElementById("download-report");

const elapsed = document.getElementById("review-elapsed");
let elapsedTimer = null;
const downloadUrls = new Map();

function stopProgress() {
  window.clearInterval(elapsedTimer);
  elapsedTimer = null;
  elapsed.textContent = "";
  elapsed.hidden = true;
}
function startProgress() {
  stopProgress();
  const started = performance.now();
  const tick = () => {
    const seconds = Math.floor((performance.now() - started) / 1000);
    elapsed.textContent = `Elapsed: ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  };
  tick();
  elapsed.hidden = false;
  elapsedTimer = window.setInterval(tick, 1000);
}
function clearDownloads() {
  for (const [link, url] of downloadUrls) {
    URL.revokeObjectURL(url);
    link.removeAttribute("href");
    link.removeAttribute("download");
    link.hidden = true;
  }
  downloadUrls.clear();
}

function show(box, text) { box.textContent = text; box.hidden = false; }
function hide(box) { box.hidden = true; box.textContent = ""; }
function base64FromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}
function blobFromBase64(base64, type) {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type });
}
function attachDownload(link, blob, fileName) {
  const previousUrl = downloadUrls.get(link);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  const url = URL.createObjectURL(blob);
  downloadUrls.set(link, url);
  link.href = url;
  link.download = fileName;
  link.hidden = false;
}
function renderResult(data) {
  clearDownloads();
  const c = data.report.counts;
  const automatic = c.indefiniteArticle + c.numericApostropheS + (2 * c.doubleQuotePairs) + (2 * c.singleQuotePairs);
  summary.textContent = `${automatic} automatic character changes; ${data.report.flags.length} paragraph(s) flagged for manual review.`;
  flags.innerHTML = "";
  flags.classList.toggle("no-flags", !data.report.flags.length);
  if (!data.report.flags.length) {
    const li = document.createElement("li");
    li.textContent = "No ambiguous quotation patterns were flagged.";
    flags.appendChild(li);
  } else {
    data.report.flags.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = `${item.part}, paragraph ${item.paragraph}: ${item.issue} — ${item.excerpt}`;
      flags.appendChild(li);
    });
  }
  attachDownload(downloadDocx, blobFromBase64(data.fileBase64, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), data.fileName);
  const reportName = data.fileName.replace(/\.docx$/i, "_report.txt");
  attachDownload(downloadReport, new Blob([data.report.reportText], { type: "text/plain;charset=utf-8" }), reportName);
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  hide(errorBox); hide(statusBox); resultCard.hidden = true;
  const accessCode = accessInput.value.trim();
  const file = fileInput.files[0];
  if (!/^[A-Za-z0-9-]{8,32}$/.test(accessCode)) return show(errorBox, "Enter the access code you received.");
  if (!file || !file.name.toLowerCase().endsWith(".docx")) return show(errorBox, "Choose a DOCX file.");
  if (file.size > 8 * 1024 * 1024) return show(errorBox, "Use a DOCX file no larger than 8 MB.");
  submitButton.disabled = true;
  submitButton.textContent = "Running Preflight…";
  show(statusBox, "Uploading and checking your document\u2026 Your original file will not be changed.");
  startProgress();
  try {
    const fileBase64 = await base64FromFile(file);
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode, fileName: file.name, fileBase64 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Preflight could not process this file.");
    hide(statusBox);
    renderResult(data);
  } catch (error) {
    clearDownloads();
    hide(statusBox);
    show(errorBox, error.message || "Preflight could not process this file.");
  } finally {
    stopProgress();
    submitButton.disabled = false;
    submitButton.textContent = "Run Afrikaans Preflight";
  }
});
