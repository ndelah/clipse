import {loadSettings, HISTORY_FORMAT, HISTORY_VERSION, videoIdFromUrl, videoUrl, timestamp, summaryMarkdown, summaryParagraphs, normalizeSummary} from "./shared.js";
import {loadSettingsForm, wireSettingsForm} from "./settings-form.js";
import {SCORE_RUBRICS, ROUTING_CONFIDENCE} from "./routing.js";
import {recoveryFor} from "./recovery.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map(element => [element.id, element]));
let view = "history";
let returnView = "history";
let onboardingPage = 0;
let selectedSummary = null;
let displayedSummary = null;
let activeJobId = null;
let failedJobId = null;
let retryVideoId = null;
let retryVideoTitle = "";
let pollTimer = null;
let navigationRevision = 0;
let historyRevision = 0;
let starting = false;
let pendingFocus = false;
let lastStage = "";
const disclosureState = new Map();

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Clipse could not complete this action. Try again.");
  return response;
}
function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("error", error);
}
function announce(message) { if (elements.announcer.textContent !== message) elements.announcer.textContent = message; }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
function reading() { return view === "job" || (view === "history" && selectedSummary); }
function focusContent() {
  if (!pendingFocus) return;
  pendingFocus = false;
  if (view === "history" && !selectedSummary) elements.historySearch.focus();
  else if (view === "settings") elements.apiKey.focus();
  else if (view === "onboarding") (onboardingPage === 0 ? elements.onboardingIntroHeading : elements.onboardingHeading).focus();
  else if (!elements.errorState.classList.contains("hidden")) elements.errorHeading.focus();
  else if (!elements.loadingState.classList.contains("hidden")) elements.jobStage.focus();
  else if (!elements.resultState.classList.contains("hidden")) elements.videoTitleLink.focus();
  else elements.currentView.querySelector("section:not(.hidden) h2")?.focus();
}
function showView(name, focus = false) {
  if (name === "settings" && view !== "settings") returnView = view;
  view = name;
  navigationRevision += 1;
  stopPolling(); pendingFocus = focus;
  elements.settingsButton.setAttribute("aria-expanded", String(name === "settings"));
  elements.currentView.classList.toggle("hidden", !reading());
  elements.historyView.classList.toggle("hidden", name !== "history" || Boolean(selectedSummary));
  elements.settingsView.classList.toggle("hidden", name !== "settings");
  elements.onboardingView.classList.toggle("hidden", name !== "onboarding");
  elements.savedNavigation.classList.toggle("hidden", !reading());
  if (reading()) {
    if (!selectedSummary) displayedSummary = null;
    if (selectedSummary) { renderSummary(selectedSummary); showCurrentState("resultState"); }
    if (activeJobId) watchJob();
  } else if (name === "history") renderHistory().catch(error => setStatus(elements.historyStatus, error.message, true));
  else if (name === "onboarding") { setOnboardingPage(onboardingPage); focusContent(); }
  else Promise.all([loadSettingsForm(elements), renderHistory()]).then(focusContent).catch(error => setStatus(elements.settingsStatus, error.message, true));
}
function showCurrentState(id) {
  const retainSummary = displayedSummary && !displayedSummary.sample && ["loadingState", "errorState"].includes(id);
  for (const stateId of ["loadingState", "errorState", "resultState"]) {
    elements[stateId].classList.toggle("hidden", stateId !== id && !(retainSummary && stateId === "resultState"));
  }
  elements.loadingState.classList.toggle("compact-running", Boolean(retainSummary));
  elements.refreshButton.disabled = Boolean(activeJobId) || starting || Boolean(displayedSummary?.sample);
  focusContent();
}
function showError(error) {
  stopPolling(); pendingFocus = true;
  const recovery = recoveryFor(error);
  elements.errorHeading.textContent = /caption|transcript/i.test(recovery.message) ? "Couldn’t read captions" : "Could not create summary";
  elements.errorVideoTitle.textContent = displayedSummary?.title || retryVideoTitle;
  elements.errorMessage.setAttribute("role", "alert");
  setStatus(elements.errorMessage, recovery.message, true);
  elements.errorDiagnostic.textContent = error.message || String(error);
  elements.errorDetails.classList.toggle("hidden", false);
  elements.errorDetails.open = false;
  elements.discardErrorButton.classList.toggle("hidden", !failedJobId);
  elements.errorSettingsButton.classList.toggle("hidden", recovery.action !== "settings");
  elements.reloadVideoButton.classList.toggle("hidden", recovery.action !== "reload" || !retryVideoId);
  elements.retryButton.classList.toggle("hidden", recovery.action === "none" || recovery.action === "reload");
  elements.retryButton.textContent = "Restart summary";
  showCurrentState("errorState"); announce(recovery.message);
}
function showStopped() {
  stopPolling(); activeJobId = null; failedJobId = null;
  elements.discardErrorButton.classList.toggle("hidden", true);
  elements.errorHeading.textContent = "Summary stopped";
  elements.errorVideoTitle.textContent = displayedSummary?.title || retryVideoTitle;
  elements.errorMessage.setAttribute("role", "status");
  setStatus(elements.errorMessage, displayedSummary ? "Your previous summary is still available below. Restarting begins again and may incur API charges." : "Nothing new was saved. Restarting begins again and may incur API charges.");
  for (const id of ["errorDetails", "errorSettingsButton", "reloadVideoButton"]) elements[id].classList.toggle("hidden", true);
  elements.retryButton.classList.toggle("hidden", false);
  showCurrentState("errorState"); announce("Summary stopped.");
}
function watchJob() {
  stopPolling(); pollJob().catch(showError);
  pollTimer = setInterval(() => pollJob().catch(showError), 2000);
}
async function pollJob() {
  if (!activeJobId || !reading()) return;
  const id = activeJobId, revision = navigationRevision;
  const state = await chrome.storage.local.get({jobs: {}, summaries: {}});
  if (activeJobId !== id || revision !== navigationRevision) return;
  const job = state.jobs[id];
  if (!job) { activeJobId = null; throw new Error("This job is no longer available. Try again."); }
  retryVideoTitle = job.title || "YouTube video";
  retryVideoId = job.videoId;
  if (job.status === "completed") {
    stopPolling(); activeJobId = null;
    const summary = state.summaries[job.videoId];
    if (!summary) throw new Error("The summary was removed from history. You can regenerate it.");
    if (view === "job" && !displayedSummary) {
      selectedSummary = null; showView("history", true);
      announce(`Summary saved: ${summary.title || "YouTube video"}.`); return;
    }
    if (reading()) selectedSummary = summary;
    pendingFocus = !displayedSummary || Boolean(elements.loadingState.contains?.(document.activeElement)) || Boolean(elements.keyTakeaways.contains?.(document.activeElement));
    renderSummary(summary); showCurrentState("resultState"); announce(`Summary saved: ${summary.title || "YouTube video"}.`);
  } else if (job.status === "cancelled") showStopped();
  else if (job.status === "failed") { failedJobId = job.id; activeJobId = null; throw new Error(job.error || "Processing failed."); }
  else renderJob(job);
}
function renderJob(job) {
  retryVideoId = job.videoId;
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(job.createdAt)) / 1000));
  const captionsReady = job.transcriptReady === true || job.progress >= 20;
  const stage = !captionsReady ? "Reading captions" : /section \d+ of \d+/i.test(job.stage || "") ? job.stage : /choosing|classif/i.test(job.stage || "") ? "Choosing summary approach" : "Writing summary";
  elements.jobStage.textContent = stage;
  elements.jobVideoTitle.textContent = job.title || "YouTube video";
  elements.progressText.textContent = `${timestamp(elapsed)} elapsed`;
  elements.jobHint.textContent = captionsReady ? "Captions are ready. You can switch tabs or close Clipse." : "Keep this video tab open while captions are read.";
  if (lastStage !== `${job.id}:${stage}`) { announce(`${job.title}. ${stage}. ${elements.jobHint.textContent}`); lastStage = `${job.id}:${stage}`; }
  showCurrentState("loadingState");
}
async function startSummary(forceRefresh = false) {
  if (starting) return;
  const revision = navigationRevision;
  const target = selectedSummary || (forceRefresh ? displayedSummary : null);
  starting = true;
  for (const id of ["refreshButton", "retryButton"]) elements[id].disabled = true;
  try {
    const settings = await loadSettings(chrome.storage.local);
    if (!settings.apiKey) { showView("settings", true); return; }
    const videoId = target?.videoId || retryVideoId;
    const message = {type: "START_JOB", videoId, forceRefresh};
    if (!videoId) throw new Error("Open a captioned YouTube video first.");
    announce("Opening the source video and starting your summary.");
    if (displayedSummary) setStatus(elements.resultStatus, "Opening the source video. Your existing summary will remain available while a new one is created.");
    const response = await send(message);
    if (revision !== navigationRevision) return;
    failedJobId = null; activeJobId = response.jobId; retryVideoId = videoId; pendingFocus = true;
    watchJob();
  } catch (error) { if (revision === navigationRevision) showError(error); }
  finally {
    starting = false;
    elements.retryButton.disabled = false;
    elements.refreshButton.disabled = Boolean(activeJobId) || Boolean(displayedSummary?.sample);
  }
}
async function stopActiveJob() {
  if (!activeJobId) return;
  elements.stopJobButton.disabled = true; pendingFocus = true;
  try { await send({type: "CANCEL_JOB", jobId: activeJobId}); await pollJob(); }
  catch (error) { showError(error); }
  finally { elements.stopJobButton.disabled = false; }
}
async function seek(summary, seconds) {
  if (summary.sample) return;
  try { await send({type: "SEEK_SUMMARY", videoId: summary.videoId, seconds}); }
  catch (error) { setStatus(elements.resultStatus, error.message, true); }
}
function renderClassification(preview) {
  elements.contentType.textContent = preview.content_type || "Video";
  elements.level.textContent = `${preview.level || "Mixed"} level`;
  elements.density.textContent = preview.useful_content_density ? `${preview.useful_content_density} information density` : "";
  const classification = preview.classification;
  const knowledge = classification?.scores?.prior_knowledge;
  const density = classification?.scores?.content_density;
  const specificity = classification?.scores?.instruction_specificity;
  if (classification) {
    elements.contentType.textContent = classification.categoryName || preview.content_type || "Other";
    elements.level.textContent = knowledge?.confidence >= ROUTING_CONFIDENCE
      ? `Assumes ${["no prior knowledge", "working familiarity", "specialist knowledge"][Math.round(knowledge.score)]}` : "Prior knowledge unclear";
    elements.density.textContent = density?.confidence >= ROUTING_CONFIDENCE
      ? `${SCORE_RUBRICS.content_density.labels[Math.round(density.score)]} information density` : "Density unclear";
  }
  elements.specificity.classList.toggle("hidden", !(specificity?.confidence >= ROUTING_CONFIDENCE));
  elements.specificity.textContent = specificity ? SCORE_RUBRICS.instruction_specificity.labels[Math.round(specificity.score)] : "";
  elements.classificationNote.textContent = classification?.reason === "request_failed" || classification?.reason === "invalid_response"
    ? "Classification was unavailable; the fallback summary approach was used."
    : classification?.reason === "uncertain" ? "Category was uncertain; the fallback summary approach was used."
    : `Classification and recommendations are AI estimates.${classification?.sampled ? " Classification uses excerpts from across the video." : ""}`;
}
function renderSummary(summary) {
  const previousId = displayedSummary?.videoId;
  displayedSummary = summary; retryVideoId = summary.videoId;
  const preview = summary.preview || {};
  elements.videoTitleLink.textContent = summary.title || "YouTube video";
  elements.videoTitleLink.setAttribute("tabindex", summary.sample ? "-1" : "0");
  if (summary.sample) elements.videoTitleLink.removeAttribute("href");
  else elements.videoTitleLink.href = videoUrl(summary.videoId);
  elements.videoLink.href = videoUrl(summary.videoId);
  elements.videoLink.classList.toggle("hidden", Boolean(summary.sample));
  elements.sampleNotice.classList.toggle("hidden", !summary.sample);
  elements.resultFooter.classList.toggle("hidden", Boolean(summary.sample));
  elements.resultChannel.textContent = summary.channel || "YouTube";
  elements.resultDuration.textContent = summary.durationSeconds ? timestamp(summary.durationSeconds) : "";
  const captionType = summary.transcriptIsGenerated === true ? "automatic captions" : summary.transcriptIsGenerated === false ? "manual captions" : "caption type unknown";
  elements.transcriptInfo.textContent = `Based on captions · ${summary.transcriptLanguage || "language unavailable"} · ${captionType}`;
  renderClassification(preview);
  elements.oneSentenceSummary.textContent = preview.one_sentence_summary || "";
  elements.worthWatching.textContent = preview.worth_watching || "";
  elements.keyTakeaways.replaceChildren();
  for (const takeaway of preview.key_takeaways || []) {
    const row = document.createElement("div"); row.className = "takeaway";
    const hasTimestamp = Number.isFinite(takeaway.timestamp_seconds) && !summary.sample;
    if (hasTimestamp) {
      const stamp = document.createElement("button"); stamp.className = "timestamp"; stamp.type = "button";
      stamp.textContent = timestamp(takeaway.timestamp_seconds);
      stamp.setAttribute("aria-label", `Play at ${timestamp(takeaway.timestamp_seconds)}: ${takeaway.text}`);
      stamp.addEventListener("click", () => seek(summary, takeaway.timestamp_seconds));
      row.appendChild(stamp);
    }
    const text = document.createElement("p"); text.className = "takeaway-text"; text.textContent = takeaway.text;
    row.appendChild(text);
    elements.keyTakeaways.appendChild(row);
  }
  elements.takeawaysSection.classList.toggle("hidden", !preview.key_takeaways?.length);
  elements.fullSummary.replaceChildren();
  for (const text of summaryParagraphs(preview.full_summary)) {
    const paragraph = document.createElement("p"); paragraph.textContent = text; elements.fullSummary.appendChild(paragraph);
  }
  elements.fullSummarySection.classList.toggle("hidden", !preview.full_summary);
  // A repeated render must not collapse detail while someone is reading it.
  if (previousId !== summary.videoId) {
    const stored = disclosureState.get(summary.videoId) || {};
    elements.takeawaysSection.open = stored.takeaways === true;
    elements.fullSummarySection.open = stored.full === true; elements.aboutVideo.open = stored.about === true;
  }
  setStatus(elements.resultStatus, "");
  for (const id of ["copySummaryButton", "exportMarkdownButton", "refreshButton"]) elements[id].disabled = Boolean(summary.sample) || (id === "refreshButton" && Boolean(activeJobId));
}
function formatDate(value) {
  const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, {dateStyle: "medium"}).format(date) : "";
}
function openSaved(summary) {
  selectedSummary = summary; activeJobId = null; failedJobId = null; showView("history", true);
}
function createHistoryCard(summary) {
  const card = document.createElement("article"); card.className = "history-card";
  const content = document.createElement("div");
  const title = document.createElement("button"); title.className = "history-title"; if (!title.dataset) title.dataset = {};
  title.dataset.videoId = summary.videoId; title.dataset.action = "read";
  title.textContent = summary.title || "YouTube video"; title.addEventListener("click", () => openSaved(summary));
  const overview = document.createElement("p"); overview.className = "history-summary"; overview.textContent = summary.preview?.one_sentence_summary || "Saved summary";
  const meta = document.createElement("p"); meta.className = "history-meta";
  const metadata = document.createElement("span"); metadata.className = "history-context";
  if (summary.channel) {
    const channel = document.createElement("span"); channel.textContent = summary.channel; metadata.appendChild(channel);
  }
  const date = document.createElement("span"); date.textContent = [summary.durationSeconds ? timestamp(summary.durationSeconds) : "", formatDate(summary.updatedAt || summary.createdAt)].filter(Boolean).join(" · ");
  metadata.appendChild(date);
  const original = document.createElement("a"); original.className = "youtube-link"; original.href = videoUrl(summary.videoId); original.target = "_blank"; original.rel = "noreferrer";
  original.setAttribute("aria-label", `Open video on YouTube: ${summary.title || "YouTube video"}`); original.title = "Open video on YouTube";
  const logo = document.createElement("img"); logo.src = "icons/youtube.svg"; logo.width = 28; logo.height = 20; logo.alt = "";
  const watchLabel = document.createElement("span"); watchLabel.textContent = "Watch";
  original.append(logo, watchLabel); meta.append(metadata, original);
  const footer = document.createElement("div"); footer.className = "history-footer";
  const remove = document.createElement("button"); remove.className = "text-button danger-text history-delete"; remove.textContent = "Delete";
  if (!remove.dataset) remove.dataset = {};
  remove.dataset.videoId = summary.videoId; remove.dataset.action = "delete";
  remove.setAttribute("aria-label", `Delete summary: ${summary.title || "YouTube video"}`);
  remove.addEventListener("click", () => deleteHistory(summary.videoId));
  footer.append(meta, remove); content.append(title, overview, footer); card.appendChild(content); return card;
}
function focusHistory(videoId, action = "read") {
  const target = elements.historyList.querySelector(`[data-video-id="${videoId}"][data-action="${action}"]`);
  (target || elements.historySearch).focus();
}
async function renderHistory() {
  const revision = ++historyRevision;
  const {summaries, jobs, historyUndo} = await chrome.storage.local.get({summaries: {}, jobs: {}, historyUndo: null});
  if (revision !== historyRevision) return;
  const all = Object.values(summaries).filter(summary => videoIdFromUrl(summary.url) === summary.videoId);
  elements.clearHistoryButton.disabled = !all.length;
  elements.clearHistoryMessage.textContent = `Delete all ${all.length} summaries? You can undo this until your next deletion.`;
  for (const button of [elements.undoHistoryButton, elements.undoManagedHistoryButton]) button.classList.toggle("hidden", !historyUndo?.records?.length);
  if (view !== "history" || selectedSummary) return;
  const focused = document.activeElement?.dataset;
  const query = elements.historySearch.value.trim().toLocaleLowerCase();
  const pending = latestVisibleJobs(jobs);
  const records = [...all.map(summary => ({summary, date: summary.updatedAt || summary.createdAt})),
    ...pending.map(job => ({job, date: job.createdAt}))];
  const items = records.filter(({summary, job}) => {
    const texts = summary ? [summary.title, summary.channel, summary.preview?.one_sentence_summary, summary.preview?.full_summary,
      ...(summary.preview?.key_takeaways || []).map(item => item.text)]
      : [job.title, job.status === "failed" ? "Failed" : "Processing", job.status === "failed" ? recoveryFor(job.error).message : job.stage];
    return texts.some(text => String(text || "").toLocaleLowerCase().includes(query));
  }).sort((a, b) => dateValue(b.date) - dateValue(a.date));
  elements.historyList.replaceChildren();
  for (const item of items) elements.historyList.appendChild(item.job ? createJobCard(item.job, summaries) : createHistoryCard(item.summary));
  const failures = pending.filter(job => job.status === "failed").length;
  const processing = pending.length - failures;
  elements.historyCount.textContent = query ? `${items.length} of ${records.length}` :
    [`${all.length} saved`, failures ? `${failures} failed` : "", processing ? `${processing} processing` : ""].filter(Boolean).join(" · ");
  elements.historyCount.classList.toggle("has-errors", failures > 0);
  elements.emptyHistory.classList.toggle("hidden", items.length > 0);
  elements.emptyHistory.textContent = query && records.length ? "No videos match your search." : "Your summarized videos will appear here.";
  if (focused?.videoId) focusHistory(focused.videoId, focused.action);
  focusContent();
}
async function deleteHistory(videoId) {
  const status = view === "settings" ? elements.historyManagementStatus : elements.historyStatus;
  try {
    const result = await send({type: "DELETE_HISTORY", videoId});
    setStatus(status, result.count ? `${result.count} summar${result.count === 1 ? "y" : "ies"} deleted. Undo is available until your next deletion.` : "Nothing to delete.");
    elements.clearConfirmation.classList.toggle("hidden", true);
    await renderHistory(); (view === "settings" ? elements.undoManagedHistoryButton : elements.undoHistoryButton).focus();
  } catch (error) { setStatus(status, error.message, true); }
}
function download(content, mimeType, filename) {
  const url = URL.createObjectURL(new Blob([content], {type: mimeType}));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportHistory() {
  try {
    const {summaries} = await chrome.storage.local.get({summaries: {}});
    const records = Object.values(summaries).map(normalizeSummary).filter(Boolean);
    download(JSON.stringify({format: HISTORY_FORMAT, version: HISTORY_VERSION, exportedAt: new Date().toISOString(), summaries: records}, null, 2), "application/json", `clipse-history-${new Date().toISOString().slice(0, 10)}.json`);
    setStatus(elements.historyManagementStatus, `Backed up ${records.length} summaries. Keys and settings are excluded.`);
  } catch (error) { setStatus(elements.historyManagementStatus, error.message, true); }
}
async function importHistoryFile(file) {
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("Choose a history file smaller than 10 MB.");
    const result = await send({type: "IMPORT_HISTORY", payload: JSON.parse(await file.text())});
    setStatus(elements.historyManagementStatus, `Added ${result.added}, updated ${result.updated}, skipped ${result.skipped} invalid records. Unchanged records were kept.`);
    await renderHistory();
  } catch (error) { setStatus(elements.historyManagementStatus, error.message, true); }
  finally { elements.importHistoryInput.value = ""; }
}
function dateValue(value) { return Date.parse(value) || 0; }
function latestVisibleJobs(jobs) {
  const latest = new Map();
  for (const job of Object.values(jobs).sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt))) latest.set(job.videoId, job);
  return [...latest.values()].filter(job => ["queued", "running", "failed"].includes(job.status) && !job.dismissedAt);
}
function openJob(job, summaries) {
  failedJobId = null; selectedSummary = summaries[job.videoId] || null;
  activeJobId = job.id; retryVideoId = job.videoId; retryVideoTitle = job.title || "YouTube video";
  showView("job", true);
}
function createJobCard(job, summaries) {
  const failed = job.status === "failed";
  const card = document.createElement("article"); card.className = `history-card job-card ${failed ? "job-failed" : "job-processing"}`;
  const label = document.createElement("p"); label.className = "job-label";
  const dot = document.createElement("span"); dot.className = "job-dot"; dot.setAttribute("aria-hidden", "true");
  const status = document.createElement("span"); status.textContent = failed ? "Summary failed" : "Summary in progress";
  label.append(dot, status);
  const title = document.createElement("button"); title.className = "history-title";
  title.dataset.videoId = job.videoId; title.dataset.action = "review";
  title.textContent = job.title || "YouTube video"; title.addEventListener("click", () => openJob(job, summaries));
  const description = document.createElement("p"); description.className = "job-description";
  description.textContent = failed ? recoveryFor(job.error).message : job.stage || "Getting your video ready. You can keep browsing.";
  const footer = document.createElement("div"); footer.className = "history-footer job-actions";
  const review = document.createElement("button"); review.className = "text-button job-review";
  review.textContent = failed ? "Review error →" : "View progress →";
  review.dataset.videoId = job.videoId; review.dataset.action = "review";
  review.setAttribute("aria-label", `${failed ? "Review error" : "View progress"}: ${title.textContent}`);
  review.addEventListener("click", () => openJob(job, summaries));
  footer.appendChild(review);
  if (failed) {
    const discard = document.createElement("button"); discard.className = "text-button history-delete discard-error"; discard.textContent = "Discard";
    discard.dataset.videoId = job.videoId; discard.dataset.action = "discard";
    discard.setAttribute("aria-label", `Discard error: ${title.textContent}`);
    discard.addEventListener("click", () => discardError(job.id, discard)); footer.appendChild(discard);
  }
  card.append(label, title, description, footer); return card;
}
async function discardError(jobId, button = elements.discardErrorButton) {
  button.disabled = true;
  try {
    await send({type: "DISMISS_ERROR", jobId});
    if (failedJobId === jobId) {
      failedJobId = null; activeJobId = null; selectedSummary = null; showView("history", true);
    }
    setStatus(elements.historyStatus, "Error discarded."); announce("Error discarded.");
    await renderHistory();
    if (view === "history" && !selectedSummary) elements.historySearch.focus();
  } catch (error) {
    setStatus(view === "job" ? elements.errorMessage : elements.historyStatus, error.message, true);
  } finally { button.disabled = false; }
}
function setOnboardingPage(page, focus = false) {
  onboardingPage = page === 1 ? 1 : 0;
  elements.onboardingIntroSlide.classList.toggle("hidden", onboardingPage !== 0);
  elements.onboardingSetupSlide.classList.toggle("hidden", onboardingPage !== 1);
  elements.onboardingView.setAttribute("aria-labelledby", onboardingPage === 0 ? "onboardingIntroHeading" : "onboardingHeading");
  for (const [index, button] of [elements.onboardingIntroButton, elements.onboardingSetupButton].entries()) {
    if (index === onboardingPage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  if (focus) {
    pendingFocus = true; focusContent();
    elements.onboardingView.scrollIntoView?.({block: "start"});
  }
}
async function dismissOnboarding() {
  try {
    await chrome.storage.local.set({onboardingDismissed: true});
    selectedSummary = null; activeJobId = null; showView("history", true);
  } catch (error) { setStatus(elements.onboardingStatus, error.message, true); }
}
async function initializeView() {
  const revision = navigationRevision;
  try {
    const {apiKey, onboardingDismissed, summaries} = await chrome.storage.local.get({apiKey: "", onboardingDismissed: false, summaries: {}});
    if (revision !== navigationRevision) return;
    showView(apiKey || onboardingDismissed || Object.keys(summaries).length ? "history" : "onboarding");
  } catch (error) {
    if (revision !== navigationRevision) return;
    showView("onboarding"); setStatus(elements.onboardingStatus, error.message, true);
  }
}

elements.settingsButton.addEventListener("click", () => showView("settings", true));
elements.backToHistoryButton.addEventListener("click", () => { selectedSummary = null; activeJobId = null; showView("history", true); });
elements.settingsDoneButton.addEventListener("click", () => showView(returnView, true));
for (const button of [elements.errorSettingsButton]) button.addEventListener("click", () => showView("settings", true));
for (const button of [elements.dismissOnboardingButton, elements.skipIntroButton]) button.addEventListener("click", dismissOnboarding);
elements.toggleOnboardingKeyButton.addEventListener("click", () => {
  const showing = elements.onboardingApiKey.type === "text";
  elements.onboardingApiKey.type = showing ? "password" : "text";
  elements.toggleOnboardingKeyButton.textContent = showing ? "Show" : "Hide";
  elements.toggleOnboardingKeyButton.setAttribute("aria-label", `${showing ? "Show" : "Hide"} API key`);
  elements.toggleOnboardingKeyButton.setAttribute("aria-pressed", String(!showing));
});
elements.setupButton.addEventListener("click", async () => {
  const apiKey = elements.onboardingApiKey.value.trim();
  if (!apiKey) { setStatus(elements.onboardingStatus, "Enter your OpenAI API key first.", true); elements.onboardingApiKey.focus(); return; }
  elements.setupButton.disabled = true;
  elements.onboardingConnection.setAttribute("inert", "");
  elements.onboardingSetupSlide.setAttribute("aria-busy", "true");
  elements.setupButton.textContent = "Connecting…";
  setStatus(elements.onboardingStatus, "Checking summaries and video classification…");
  try {
    const settings = await loadSettings(chrome.storage.local);
    const response = await chrome.runtime.sendMessage({type: "VALIDATE_SETTINGS", settings: {apiKey, model: settings.model}});
    if (!response?.ok) throw new Error(response?.error || "Could not verify access. Try again.");
    await chrome.storage.local.set({apiKey, onboardingDismissed: true});
    elements.onboardingApiKey.value = "";
    elements.onboardingApiKey.type = "password";
    elements.toggleOnboardingKeyButton.textContent = "Show";
    elements.toggleOnboardingKeyButton.setAttribute("aria-label", "Show API key");
    elements.toggleOnboardingKeyButton.setAttribute("aria-pressed", "false");
    setStatus(elements.onboardingStatus, "");
    showView("history");
  } catch (error) { setStatus(elements.onboardingStatus, error.message, true); }
  finally {
    elements.setupButton.disabled = false;
    elements.setupButton.textContent = "Connect and continue";
    elements.onboardingConnection.removeAttribute("inert");
    elements.onboardingSetupSlide.setAttribute("aria-busy", "false");
  }
});
elements.onboardingNextButton.addEventListener("click", () => setOnboardingPage(1, true));
elements.onboardingIntroButton.addEventListener("click", () => setOnboardingPage(0, true));
elements.onboardingSetupButton.addEventListener("click", () => setOnboardingPage(1, true));
elements.onboardingHelpButton.addEventListener("click", () => { setOnboardingPage(0); showView("onboarding", true); });
elements.retryButton.addEventListener("click", () => startSummary(true));
elements.refreshButton.addEventListener("click", () => startSummary(true));
elements.stopJobButton.addEventListener("click", stopActiveJob);
elements.reloadVideoButton.addEventListener("click", async () => {
  try { await send({type: "RELOAD_VIDEO", videoId: retryVideoId}); elements.reloadVideoButton.classList.toggle("hidden", true); elements.retryButton.classList.toggle("hidden", false); elements.retryButton.focus(); setStatus(elements.errorMessage, "The source video is reloading. Once it finishes, restart the summary."); }
  catch (error) { showError(error); }
});
elements.discardErrorButton.addEventListener("click", () => { if (failedJobId) return discardError(failedJobId); });
elements.historySearch.addEventListener("input", () => renderHistory().catch(error => setStatus(elements.historyStatus, error.message, true)));
elements.clearHistoryButton.addEventListener("click", () => { elements.clearConfirmation.classList.toggle("hidden", false); elements.cancelClearButton.focus(); });
elements.cancelClearButton.addEventListener("click", () => { elements.clearConfirmation.classList.toggle("hidden", true); elements.clearHistoryButton.focus(); });
elements.confirmClearButton.addEventListener("click", () => deleteHistory());
for (const button of [elements.undoHistoryButton, elements.undoManagedHistoryButton]) button.addEventListener("click", async () => {
  const status = view === "settings" ? elements.historyManagementStatus : elements.historyStatus;
  try { await send({type: "UNDO_HISTORY"}); setStatus(status, "Deletion undone. Newer summaries were kept."); await renderHistory(); (view === "settings" ? elements.clearHistoryButton : elements.historySearch).focus(); }
  catch (error) { setStatus(status, error.message, true); }
});
elements.exportHistoryButton.addEventListener("click", exportHistory);
elements.importHistoryButton.addEventListener("click", () => elements.importHistoryInput.click());
elements.importHistoryInput.addEventListener("change", () => importHistoryFile(elements.importHistoryInput.files?.[0]));
elements.copySummaryButton.addEventListener("click", async () => {
  if (!displayedSummary || displayedSummary.sample) return;
  try { await navigator.clipboard.writeText(summaryMarkdown(displayedSummary)); setStatus(elements.resultStatus, "Summary copied with source and timestamp links."); }
  catch { setStatus(elements.resultStatus, "Clipboard access failed. Download Markdown to save the summary.", true); }
});
elements.exportMarkdownButton.addEventListener("click", () => {
  if (!displayedSummary || displayedSummary.sample) return;
  download(summaryMarkdown(displayedSummary), "text/markdown;charset=utf-8", `clipse-${displayedSummary.videoId}.md`); setStatus(elements.resultStatus, "Markdown downloaded.");
});
for (const [id, key] of [["takeawaysSection", "takeaways"], ["fullSummarySection", "full"], ["aboutVideo", "about"]]) elements[id].addEventListener("toggle", () => {
  if (displayedSummary) disclosureState.set(displayedSummary.videoId, {...disclosureState.get(displayedSummary.videoId), [key]: elements[id].open});
});
wireSettingsForm(elements, {onSaved(settings) {
  if (settings.apiKey) {
    if (returnView === "onboarding") returnView = "history";
    chrome.storage.local.set({onboardingDismissed: true}).catch(error => setStatus(elements.settingsStatus, error.message, true));
  }
  announce("Settings saved.");
}});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const completed = Object.values(changes.jobs?.newValue || {}).find(job => job.status === "completed"
    && changes.jobs?.oldValue?.[job.id]?.status !== "completed");
  const failed = Object.values(changes.jobs?.newValue || {}).find(job => job.status === "failed" && !job.dismissedAt
    && changes.jobs?.oldValue?.[job.id]?.status !== "failed");
  if (failed) announce(`Summary failed: ${failed.title || "YouTube video"}. ${recoveryFor(failed.error).message}`);
  if (completed) announce(`Summary ready: ${completed.title || "YouTube video"}. Open it from history.`);
  if ((view === "settings" || (view === "history" && !selectedSummary)) && (changes.jobs || changes.summaries || changes.historyUndo || changes.apiKey)) renderHistory().catch(error => setStatus(view === "settings" ? elements.historyManagementStatus : elements.historyStatus, error.message, true));
  if (activeJobId && (changes.jobs || changes.summaries)) pollJob().catch(showError);
});
initializeView();

