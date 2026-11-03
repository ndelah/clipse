import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Element, event, storage, scriptContext, run, settle, summary, VIDEO_A, VIDEO_B} from "./helpers.mjs";
import {videoUrl} from "../extension/shared.js";

async function panel(seed = {}) {
  const html = readFileSync(new URL("../extension/sidepanel.html", import.meta.url), "utf8");
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const local = storage({apiKey: "test", summaries: {[VIDEO_A]: summary(), [VIDEO_B]: summary(VIDEO_B)}, ...seed});
  const messages = []; const copied = [];
  const chrome = {storage: {local, onChanged: event()}, tabs: {onActivated: event(), onUpdated: event(),
    async query() { return [{id: 1, url: videoUrl(VIDEO_B)}]; },
    async sendMessage() { return {context: {videoId: VIDEO_B, title: "Active B"}}; }},
    runtime: {async sendMessage(message) { messages.push(message); return {ok: true, jobId: "job-a"}; }}};
  const document = {querySelectorAll(selector) { return Object.entries(elements).map(([id, node]) => Object.assign(node, {id})); },
    createElement: tag => new Element(tag), body: new Element("body")};
  const globals = {};
  const context = scriptContext("sidepanel.js", {chrome, document, navigator: {clipboard: {async writeText(text) { copied.push(text); }}},
    setInterval: () => 1, clearInterval() {}, loadSettingsForm: async () => {}, wireSettingsForm(elements, callbacks) { globals.settingsCallbacks = callbacks; }});
  await settle();
  return {context, chrome, document, elements, local, messages, copied, settingsCallbacks: globals.settingsCallbacks};
}

// Cards live inside date groups: section > [heading, items].
const cards = p => p.elements.historyList.children.flatMap(group => group.children[1].children);

test("saved reading survives tab activation, tab navigation, and unrelated storage changes", async () => {
  const p = await panel();
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  for (const listener of p.chrome.tabs.onActivated.listeners) listener();
  for (const listener of p.chrome.tabs.onUpdated.listeners) listener(1, {url: videoUrl(VIDEO_B)}, {active: true});
  for (const listener of p.chrome.storage.onChanged.listeners) listener({summaries: {}, tabBindings: {}}, "local");
  await settle();
  assert.equal(run(p.context, "displayedSummary.videoId"), VIDEO_A);
  assert.equal(run(p.context, "view"), "history");
  assert.equal(p.elements.savedNavigation.classList.contains("hidden"), false);
  await p.elements.backToHistoryButton.click(); await settle();
  assert.equal(p.elements.historyView.classList.contains("hidden"), false);
  assert.equal(run(p.context, "selectedSummary"), null);
});

test("saved takeaways and regeneration carry the displayed video ID", async () => {
  const p = await panel({jobs: {"job-a": {id: "job-a", videoId: VIDEO_A, title: "Saved A", status: "running", createdAt: new Date().toISOString(), progress: 20}}});
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  await p.elements.keyTakeaways.children[0].children[0].click();
  assert.deepEqual(JSON.parse(JSON.stringify(p.messages[0])), {type: "SEEK_SUMMARY", videoId: VIDEO_A, seconds: 42});
  await p.elements.refreshButton.click(); await settle();
  assert.equal(p.messages[1].type, "START_JOB");
  assert.equal(p.messages[1].videoId, VIDEO_A);
  assert.equal(p.messages[1].context, undefined);
});

test("takeaways start closed and retain their disclosure state per video", async () => {
  const p = await panel();
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  assert.equal(p.elements.takeawaysSection.open, false);
  p.elements.takeawaysSection.open = true;
  await p.elements.takeawaysSection.fire("toggle");
  run(p.context, "renderSummary(displayedSummary)");
  assert.equal(p.elements.takeawaysSection.open, true);
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_B}'])`);
  assert.equal(p.elements.takeawaysSection.open, false);
  await p.elements.takeawaysSection.fire("toggle");
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  assert.equal(p.elements.takeawaysSection.open, true);
  p.elements.takeawaysSection.open = false;
  await p.elements.takeawaysSection.fire("toggle");
  run(p.context, "renderSummary(displayedSummary)");
  assert.equal(p.elements.takeawaysSection.open, false);
});

test("full summary renders separate plain-text paragraphs", async () => {
  const record = summary();
  record.preview.full_summary = "First idea.\r\n\r\nSecond idea.\n<script>Source text stays inert.</script>";
  const p = await panel({summaries: {[VIDEO_A]: record}});
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  assert.deepEqual(p.elements.fullSummary.children.map(node => [node.tagName, node.textContent]),
    [["p", "First idea."], ["p", "Second idea."], ["p", "<script>Source text stays inert.</script>"]]);
});

test("formatted summaries open first as Markdown, with one source note instead of classification pills", async () => {
  const record = summary(VIDEO_A, {transcriptLanguage: "English", transcriptIsGenerated: true});
  record.preview = {...record.preview, format: "follow_along", worth_watching: "Old field", full_summary: "## Steps\n1. **Mix.** [[t:83]]",
    classification: {categoryId: "other", categoryName: "Other", reason: "uncertain", scores: {}}};
  const p = await panel({summaries: {[VIDEO_A]: record}});
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  assert.equal(p.elements.fullSummarySection.open, true);
  assert.equal(p.elements.takeawaysSection.open, false);
  assert.deepEqual(p.elements.fullSummary.children.map(node => node.tagName), ["h3", "ol"]);
  assert.doesNotMatch(p.elements.fullSummary.children[1].textContent, /01:23/);
  assert.equal(p.elements.worthWatching, undefined);
  assert.equal(p.elements.aboutVideo, undefined);
  p.elements.fullSummarySection.open = false;
  await p.elements.fullSummarySection.fire("toggle");
  run(p.context, "renderSummary(displayedSummary)");
  assert.equal(p.elements.fullSummarySection.open, false);
});

test("first use offers setup before a missing-key job error", async () => {
  const p = await panel({apiKey: "", summaries: {}});
  assert.equal(p.elements.onboardingView.classList.contains("hidden"), false);
  assert.equal(p.elements.currentView.classList.contains("hidden"), true);
  assert.equal(run(p.context, "view"), "onboarding");
  assert.equal(p.elements.historyView.classList.contains("hidden"), true);
  await p.elements.onboardingNextButton.click();
  await p.elements.setupButton.click();
  assert.equal(run(p.context, "view"), "settings");
  assert.equal(p.messages.length, 0);
});

test("history searches title, channel, and summary and distinguishes no matches", async () => {
  const p = await panel();
  run(p.context, 'selectedSummary = null; showView("history")'); await settle();
  p.elements.historySearch.value = VIDEO_A;
  await p.elements.historySearch.fire("input"); await settle();
  assert.equal(cards(p).length, 1);
  assert.equal(p.elements.historyCount.textContent, "1 of 2");
  p.elements.historySearch.value = "unmatched";
  await p.elements.historySearch.fire("input"); await settle();
  assert.equal(cards(p).length, 0);
  assert.equal(p.elements.emptyHistory.textContent, "No videos match your search.");
  assert.equal(p.elements.historyCount.textContent, "0 of 2");
});

test("copy exports the selected summary with video-bound links", async () => {
  const p = await panel();
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  await p.elements.copySummaryButton.click();
  assert.ok(p.copied[0].includes(videoUrl(VIDEO_A, 42)));
  assert.ok(!p.copied[0].includes(videoUrl(VIDEO_B)));
});

test("save to Obsidian copies the note and opens a vault-bound URI", async () => {
  const p = await panel({obsidianVault: "Notes", obsidianFolder: "Sources/YouTube"});
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  await p.elements.saveObsidianButton.click(); await settle();
  assert.match(p.copied[0], /^---\ntitle: "Video abcdefghijk"/);
  assert.ok(p.copied[0].includes(videoUrl(VIDEO_A, 42)));
  assert.equal(p.document.body.children.at(-1).href, "obsidian://new?vault=Notes&file=Sources%2FYouTube%2FVideo%20abcdefghijk&clipboard=true");
  assert.equal(p.elements.resultStatus.classList.contains("error"), false);
});

test("regeneration leaves the previous summary readable through running, failure, and cancellation", async () => {
  const p = await panel({jobs: {"job-a": {id: "job-a", videoId: VIDEO_A, title: "Saved A", status: "running", createdAt: new Date().toISOString(), progress: 65}}});
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  p.elements.fullSummarySection.open = true;
  await p.elements.refreshButton.click(); await settle();
  assert.equal(p.elements.resultState.classList.contains("hidden"), false);
  assert.equal(p.elements.fullSummarySection.open, true);
  p.local.state.jobs["job-a"].status = "failed";
  p.local.state.jobs["job-a"].error = "Request timed out";
  await run(p.context, "pollJob().catch(showError)");
  assert.equal(p.elements.resultState.classList.contains("hidden"), false);
  assert.equal(run(p.context, "displayedSummary.videoId"), VIDEO_A);
  run(p.context, "showStopped()");
  assert.equal(p.elements.errorHeading.textContent, "Summary stopped");
  assert.equal(p.elements.errorMessage.getAttribute("role"), "status");
  assert.equal(p.elements.resultState.classList.contains("hidden"), false);
});

test("clear-all requires a separate confirmation for the entire history", async () => {
  const p = await panel({summaries: {[VIDEO_A]: summary(VIDEO_A, {saved: true}), [VIDEO_B]: summary(VIDEO_B)}});
  run(p.context, 'showView("history")'); await settle();
  assert.equal(cards(p).length, 2);
  await p.elements.clearHistoryButton.click();
  assert.equal(p.messages.length, 0);
  assert.equal(p.elements.clearConfirmation.classList.contains("hidden"), false);
  assert.match(p.elements.clearHistoryMessage.textContent, /all 2 summaries/);
  await p.elements.cancelClearButton.click();
  assert.equal(p.messages.length, 0);
  await p.elements.confirmClearButton.click();
  assert.equal(p.messages[0].type, "DELETE_HISTORY");
});

test("history searches inside takeaway content", async () => {
  const record = summary(); record.preview.key_takeaways[0].text = "Distinctive insight";
  const p = await panel({summaries: {[VIDEO_A]: record, [VIDEO_B]: summary(VIDEO_B)}});
  run(p.context, 'showView("history")'); await settle();
  p.elements.historySearch.value = "distinctive";
  await p.elements.historySearch.fire("input"); await settle();
  assert.equal(cards(p).length, 1);
});

test("onboarding starts with both summary entry points and puts setup last", async () => {
  const p = await panel({apiKey: "", summaries: {}});
  assert.equal(p.elements.onboardingIntroSlide.classList.contains("hidden"), false);
  assert.equal(p.elements.onboardingSetupSlide.classList.contains("hidden"), true);
  assert.equal(p.elements.onboardingIntroButton.getAttribute("aria-current"), "step");
  await p.elements.onboardingNextButton.click();
  assert.equal(p.elements.onboardingIntroSlide.classList.contains("hidden"), true);
  assert.equal(p.elements.onboardingSetupSlide.classList.contains("hidden"), false);
  assert.equal(p.elements.onboardingSetupButton.getAttribute("aria-current"), "step");
  await p.elements.onboardingIntroButton.click();
  assert.equal(p.elements.onboardingIntroSlide.classList.contains("hidden"), false);
  await p.elements.onboardingSetupButton.click();
  await p.elements.dismissOnboardingButton.click(); await settle();
  assert.equal(p.local.state.onboardingDismissed, true);
  await p.elements.settingsButton.click();
  await p.elements.onboardingHelpButton.click();
  assert.equal(p.elements.onboardingSetupSlide.classList.contains("hidden"), true);
  assert.equal(p.elements.onboardingView.getAttribute("aria-labelledby"), "onboardingIntroHeading");
  assert.equal(p.messages.length, 0);
});

test("skipping onboarding persists across panel launches without an API key", async () => {
  const p = await panel({apiKey: "", summaries: {}});
  await p.elements.skipIntroButton.click(); await settle();
  assert.equal(p.local.state.onboardingDismissed, true);
  assert.equal(run(p.context, "view"), "history");
  assert.equal(p.elements.onboardingView.classList.contains("hidden"), true);
  const reopened = await panel(p.local.state);
  assert.equal(run(reopened.context, "view"), "history");
  assert.equal(reopened.elements.historyView.classList.contains("hidden"), false);
  assert.equal(reopened.messages.length, 0);
});

test("the welcome guide can be reopened from Settings and dismissed again", async () => {
  const p = await panel({onboardingDismissed: true});
  await p.elements.settingsButton.click();
  await p.elements.onboardingHelpButton.click();
  assert.equal(run(p.context, "view"), "onboarding");
  assert.equal(p.elements.historyView.classList.contains("hidden"), true);
  await p.elements.skipIntroButton.click(); await settle();
  assert.equal(run(p.context, "view"), "history");
});

test("saving an OpenAI key completes onboarding; leaving settings unsaved returns to it", async () => {
  const p = await panel({apiKey: "", summaries: {}});
  await p.elements.onboardingNextButton.click();
  await p.elements.setupButton.click();
  await p.elements.settingsDoneButton.click();
  assert.equal(run(p.context, "view"), "onboarding");
  await p.elements.onboardingNextButton.click();
  await p.elements.setupButton.click();
  p.settingsCallbacks.onSaved({apiKey: "test"}); await settle();
  await p.elements.settingsDoneButton.click();
  assert.equal(run(p.context, "view"), "history");
  assert.equal(p.local.state.onboardingDismissed, true);
});

test("existing history bypasses onboarding even without a current key", async () => {
  const p = await panel({apiKey: ""});
  assert.equal(run(p.context, "view"), "history");
  assert.equal(p.elements.onboardingView.classList.contains("hidden"), true);
});

test("background jobs can be opened without changing the active video's identity", async () => {
  const p = await panel({jobs: {"job-a": {id: "job-a", videoId: VIDEO_A, title: "Saved A", status: "running", createdAt: new Date().toISOString(), progress: 5}}});
  assert.equal(p.elements.historyCount.textContent, "");
  await cards(p)[0].children[1].click(); await settle();
  assert.equal(run(p.context, "view"), "job");
  assert.equal(p.elements.jobVideoTitle.textContent, "Saved A");
  for (const listener of p.chrome.tabs.onActivated.listeners) listener();
  await settle();
  assert.equal(run(p.context, "retryVideoId"), VIDEO_A);
  assert.doesNotMatch(p.elements.progressText.textContent, /%/);
});

test("history is the only default screen and completed summaries wait for a click", async () => {
  const p = await panel({summaries: {}});
  assert.equal(run(p.context, "view"), "history");
  assert.equal(p.elements.historyView.classList.contains("hidden"), false);
  assert.equal(p.elements.currentView.classList.contains("hidden"), true);
  const record = summary();
  p.local.state.summaries = {[VIDEO_A]: record};
  p.local.state.jobs = {done: {id: "done", videoId: VIDEO_A, title: record.title, status: "completed"}};
  for (const listener of p.chrome.storage.onChanged.listeners) listener({summaries: {newValue: p.local.state.summaries}, jobs: {oldValue: {}, newValue: p.local.state.jobs}}, "local");
  await settle();
  assert.equal(cards(p).length, 1);
  assert.equal(run(p.context, "selectedSummary"), null);
  assert.equal(p.elements.currentView.classList.contains("hidden"), true);
  await cards(p)[0].children[0].click();
  assert.equal(run(p.context, "displayedSummary.videoId"), VIDEO_A);
  assert.equal(p.elements.resultState.classList.contains("hidden"), false);
});

test("watching a new job returns to history when it completes", async () => {
  const p = await panel({summaries: {}, jobs: {work: {id: "work", videoId: VIDEO_A, title: "New video", status: "running", createdAt: new Date().toISOString()}}});
  await cards(p)[0].children[1].click(); await settle();
  p.local.state.jobs.work.status = "completed";
  p.local.state.summaries[VIDEO_A] = summary();
  await run(p.context, "pollJob()"); await settle();
  assert.equal(run(p.context, "view"), "history");
  assert.equal(run(p.context, "selectedSummary"), null);
  assert.equal(cards(p).length, 1);
});

test("failed player jobs stay accessible for recovery from history", async () => {
  const p = await panel({summaries: {}, jobs: {failed: {id: "failed", videoId: VIDEO_A, title: "Failed video", status: "failed", error: "Request timed out"}}});
  await cards(p)[0].children[1].click(); await settle();
  assert.equal(p.elements.errorState.classList.contains("hidden"), false);
  assert.equal(run(p.context, "retryVideoId"), VIDEO_A);
  assert.equal(p.elements.retryButton.classList.contains("hidden"), false);
});

test("caption recovery retains the failed video's title and resets technical details", async () => {
  const p = await panel({summaries: {}, jobs: {failed: {id: "failed", videoId: VIDEO_A, title: "Decision models", status: "failed", error: "Could not extract the transcript from YouTube's transcript panel."}}});
  p.elements.errorDetails.open = true;
  await cards(p)[0].children[1].click(); await settle();
  assert.equal(p.elements.errorVideoTitle.textContent, "Decision models");
  assert.equal(p.elements.errorHeading.textContent, "Couldn’t read captions");
  assert.equal(p.elements.errorDetails.open, false);
  assert.equal(p.elements.reloadVideoButton.classList.contains("hidden"), false);
  assert.equal(p.elements.retryButton.classList.contains("hidden"), true);
  await p.elements.reloadVideoButton.click();
  assert.equal(p.messages.at(-1).type, "RELOAD_VIDEO");
  assert.equal(p.messages.at(-1).videoId, VIDEO_A);
  assert.equal(p.elements.retryButton.classList.contains("hidden"), false);
  await p.elements.backToHistoryButton.click(); await settle();
  assert.equal(p.elements.historyCount.textContent, "");
});


test("errors appear as searchable cards alongside saved summaries", async () => {
  const p = await panel({jobs: {failed: {id: "failed", videoId: VIDEO_A, title: "Decision models", status: "failed", createdAt: "2026-10-12T10:00:00Z", error: "Request timed out"}}});
  assert.equal(cards(p).length, 3);
  assert.equal(p.elements.historyCount.textContent, "");
  const card = cards(p)[0];
  assert.equal(card.children[0].children[1].textContent, "Summary failed");
  assert.match(card.children[2].textContent, /Processing stopped/);
  assert.equal(card.children[3].children[1].textContent, "Discard");
  p.elements.historySearch.value = "Decision models";
  await p.elements.historySearch.fire("input");
  assert.equal(cards(p).length, 1);
  assert.equal(p.elements.historyCount.textContent, "1 of 3");
});

test("discarding an error persists and does not resurrect an older failure", async () => {
  const jobs = {older: {id: "older", videoId: VIDEO_A, status: "failed", createdAt: "2026-10-11T10:00:00Z"},
    failed: {id: "failed", videoId: VIDEO_A, title: "Failed video", status: "failed", createdAt: "2026-10-12T10:00:00Z"}};
  const p = await panel({jobs});
  p.chrome.runtime.sendMessage = async message => {
    p.messages.push(message); p.local.state.jobs[message.jobId].dismissedAt = "2026-10-12T12:00:00Z";
    return {ok: true};
  };
  await cards(p)[0].children[3].children[1].click();
  assert.equal(p.messages.at(-1).type, "DISMISS_ERROR");
  assert.equal(p.messages.at(-1).jobId, "failed");
  assert.equal(cards(p).length, 2);
  assert.equal(p.elements.historyCount.textContent, "");
  const reopened = await panel({jobs: p.local.state.jobs});
  assert.equal(cards(reopened).length, 2);
  assert.equal(reopened.elements.historyCount.textContent, "");
});

test("discard works from recovery and keeps a saved summary for the same video", async () => {
  const p = await panel({jobs: {failed: {id: "failed", videoId: VIDEO_A, title: "Saved video", status: "failed", error: "Request timed out", createdAt: "2026-10-12T10:00:00Z"}}});
  await cards(p)[0].children[1].click(); await settle();
  assert.equal(p.elements.discardErrorButton.classList.contains("hidden"), false);
  p.chrome.runtime.sendMessage = async message => {
    p.messages.push(message); p.local.state.jobs[message.jobId].dismissedAt = "2026-10-12T12:00:00Z";
    return {ok: true};
  };
  await p.elements.discardErrorButton.click(); await settle();
  assert.equal(run(p.context, "view"), "history");
  assert.equal(run(p.context, "failedJobId"), null);
  assert.equal(p.elements.currentView.classList.contains("hidden"), true);
  assert.equal(cards(p).length, 2);
  assert.ok(p.local.state.summaries[VIDEO_A]);
});

test("failed discard keeps the error visible with actionable feedback", async () => {
  const p = await panel({summaries: {}, jobs: {failed: {id: "failed", videoId: VIDEO_A, status: "failed"}}});
  p.chrome.runtime.sendMessage = async () => ({ok: false, error: "Could not save. Try again."});
  const discard = cards(p)[0].children[3].children[1];
  await discard.click();
  assert.equal(discard.disabled, false);
  assert.equal(cards(p).length, 1);
  assert.equal(p.elements.historyStatus.textContent, "Could not save. Try again.");
});

test("a new failure is announced and added without interrupting reading", async () => {
  const p = await panel();
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_B}'])`);
  p.local.state.jobs = {failed: {id: "failed", videoId: VIDEO_A, title: "Failed video", status: "failed", error: "Request timed out"}};
  for (const listener of p.chrome.storage.onChanged.listeners) listener({jobs: {oldValue: {}, newValue: p.local.state.jobs}}, "local");
  await settle();
  assert.match(p.elements.announcer.textContent, /Summary failed: Failed video/);
  assert.equal(run(p.context, "displayedSummary.videoId"), VIDEO_B);
  assert.equal(p.elements.currentView.classList.contains("hidden"), false);
  await p.elements.backToHistoryButton.click(); await settle();
  assert.equal(cards(p).length, 3);
});

test("history groups by calendar bucket, newest first", async () => {
  const p = await panel();
  const now = 'new Date(2026, 9, 22, 12)'; // Thursday 22 October 2026
  const bucket = date => run(p.context, `dateBucket(${JSON.stringify(date)}, ${now})`);
  assert.equal(bucket(new Date(2026, 9, 19, 9).toISOString()), "This week");
  assert.equal(bucket(new Date(2026, 9, 18, 9).toISOString()), "This month");
  assert.equal(bucket(new Date(2026, 7, 2).toISOString()), "Last 3 months");
  assert.equal(bucket(new Date(2026, 1, 2).toISOString()), "Past year");
  assert.equal(bucket(new Date(2025, 5, 2).toISOString()), "Older");
  const older = summary(VIDEO_B, {createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z"});
  const q = await panel({summaries: {[VIDEO_A]: summary(VIDEO_A, {updatedAt: new Date().toISOString()}), [VIDEO_B]: older}});
  assert.deepEqual(q.elements.historyList.children.map(group => group.children[0].textContent), ["This week", "Older"]);
});

test("channel and category filters combine with search, and cards show channel next to date without tag pills", async () => {
  const tagged = summary(VIDEO_A, {channel: "Kitchen Science"});
  tagged.preview.topics = ["Fermentation", "Bread"];
  tagged.preview.classification = {categoryName: "Cooking", scores: {}};
  const p = await panel({summaries: {[VIDEO_A]: tagged, [VIDEO_B]: summary(VIDEO_B)}});
  assert.equal(p.elements.compactToggle, undefined);
  assert.deepEqual(p.elements.channelFilter.children.map(option => option.value), ["", "Kitchen Science", "Test channel"]);
  assert.equal(p.elements.categoryFilter.classList.contains("hidden"), true);
  p.elements.channelFilter.value = "Test channel";
  await p.elements.channelFilter.fire("change"); await settle();
  assert.deepEqual(cards(p).map(card => card.children[0].textContent), [`Video ${VIDEO_B}`]);
  assert.equal(p.elements.historyCount.textContent, "1 of 2");
  p.elements.channelFilter.value = "";
  p.elements.historySearch.value = "ferment";
  await p.elements.historySearch.fire("input"); await settle();
  assert.deepEqual(cards(p).map(card => card.children[0].textContent), [`Video ${VIDEO_A}`]);
  assert.equal(cards(p)[0].children.length, 2);
  assert.equal(cards(p)[0].children[1].className, "history-footer");
  assert.match(cards(p)[0].children[1].children[0].textContent, /^Kitchen Science · /);
});

test("each card has one actions menu, showing only the chosen destinations and never a download", async () => {
  const p = await panel();
  const menuFor = q => cards(q).find(card => card.children[0].textContent === `Video ${VIDEO_A}`).children[1].children[2];
  assert.equal(cards(p)[0].children[1].children[1].getAttribute("aria-haspopup"), "menu");
  assert.deepEqual(menuFor(p).children.map(item => item.dataset.action), ["youtube", "copy", "obsidian", "delete"]);
  await menuFor(p).children[1].click();
  assert.ok(p.copied[0].includes(videoUrl(VIDEO_A, 42)));
  await menuFor(p).children[3].click(); await settle();
  assert.equal(p.messages.at(-1).type, "DELETE_HISTORY");
  assert.equal(p.messages.at(-1).videoId, VIDEO_A);
  const notionOnly = await panel({exportTargets: ["notion"]});
  assert.deepEqual(menuFor(notionOnly).children.map(item => item.dataset.action), ["youtube", "notion", "delete"]);
  await menuFor(notionOnly).children[1].click(); await settle();
  assert.match(notionOnly.elements.historyStatus.textContent, /Set up Notion in Settings/);
  assert.equal(notionOnly.elements.historyStatus.classList.contains("error"), true);
});

test("the reading view shows only the chosen export buttons and follows changes", async () => {
  const p = await panel({exportTargets: ["download"]});
  run(p.context, `openSaved(chrome.storage.local.state.summaries['${VIDEO_A}'])`);
  const hidden = id => p.elements[id].classList.contains("hidden");
  assert.deepEqual(["copySummaryButton", "exportMarkdownButton", "saveObsidianButton", "saveNotionButton"].map(hidden), [true, false, true, true]);
  for (const listener of p.chrome.storage.onChanged.listeners) listener({exportTargets: {newValue: ["copy", "notion"]}}, "local");
  assert.deepEqual(["copySummaryButton", "exportMarkdownButton", "saveObsidianButton", "saveNotionButton"].map(hidden), [false, true, true, false]);
});

test("onboarding asks where notes go and saves the answer as it is ticked", async () => {
  const p = await panel({apiKey: "", summaries: {}});
  await settle();
  assert.deepEqual(["onboardCopy", "onboardDownload", "onboardObsidian", "onboardNotion"].map(id => p.elements[id].checked), [true, true, true, false]);
  assert.equal(p.elements.onboardingNotionNote.classList.contains("hidden"), true);
  p.elements.onboardObsidian.checked = false; p.elements.onboardNotion.checked = true;
  await p.elements.onboardNotion.fire("change");
  assert.deepEqual(p.local.state.exportTargets, ["copy", "download", "notion"]);
  assert.equal(p.elements.onboardingNotionNote.classList.contains("hidden"), false);
});

test("filters only offer values that still have videos under the other filter", async () => {
  const record = (id, channel, categoryName) => { const r = summary(id, {channel}); r.preview.classification = {categoryName, scores: {}}; return r; };
  const C = "bcdefghijkl";
  const p = await panel({summaries: {[VIDEO_A]: record(VIDEO_A, "Arxivus", "Research"), [VIDEO_B]: record(VIDEO_B, "Arxivus", "Talk"), [C]: record(C, "Kitchen", "Cooking")}});
  const labels = select => select.children.map(option => option.textContent);
  assert.deepEqual(labels(p.elements.categoryFilter), ["All categories", "Cooking (1)", "Research (1)", "Talk (1)"]);
  p.elements.channelFilter.value = "Arxivus";
  await p.elements.channelFilter.fire("change"); await settle();
  assert.deepEqual(labels(p.elements.categoryFilter), ["All categories", "Research (1)", "Talk (1)"]);
  assert.deepEqual(labels(p.elements.channelFilter), ["All channels", "Arxivus (2)", "Kitchen (1)"]);
  p.elements.categoryFilter.value = "Talk";
  await p.elements.categoryFilter.fire("change"); await settle();
  assert.deepEqual(labels(p.elements.channelFilter), ["All channels", "Arxivus (1)"]);
  assert.equal(p.elements.channelFilter.value, "Arxivus");
  assert.equal(cards(p).length, 1);
});

test("Settings lives at the top and holds the guide, GitHub, and rating links", async () => {
  const p = await panel();
  await p.elements.settingsButton.click();
  assert.equal(p.elements.settingsButton.getAttribute("aria-expanded"), "true");
  const html = readFileSync(new URL("../extension/sidepanel.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="settingsButton"') < html.indexOf("<main>"));
  for (const id of ["guideLink", "githubLink", "rateLink"]) assert.ok(html.indexOf(`id="${id}"`) > html.indexOf('id="settingsView"'), id);
  assert.doesNotMatch(html, /appFooter/);
});
