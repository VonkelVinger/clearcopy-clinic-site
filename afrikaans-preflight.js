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
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  link.hidden = false;
}
function renderResult(data) {
  const c = data.report.counts;
  const automatic = c.indefiniteArticle + c.numericApostropheS + (2 * c.doubleQuotePairs) + (2 * c.singleQuotePairs);
  summary.textContent = `${automatic} automatic character changes; ${data.report.flags.length} paragraph(s) flagged for manual review.`;
  flags.innerHTML = "";
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
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hide(errorBox); hide(statusBox); resultCard.hidden = true;
  const accessCode = accessInput.value.trim();
  const file = fileInput.files[0];
  if (!/^[A-Za-z0-9-]{8,32}$/.test(accessCode)) return show(errorBox, "Enter the access code you received.");
  if (!file || !file.name.toLowerCase().endsWith(".docx")) return show(errorBox, "Choose a DOCX file.");
  if (file.size > 8 * 1024 * 1024) return show(errorBox, "Use a DOCX file no larger than 8 MB.");
  submitButton.disabled = true;
  submitButton.textContent = "Running Preflight…";
  show(statusBox, "Uploading and checking the document. The original file will not be changed.");
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
    hide(statusBox);
    show(errorBox, error.message || "Preflight could not process this file.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Run Afrikaans Preflight";
  }
});
