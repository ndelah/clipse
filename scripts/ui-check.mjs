// Optional automated rendering checks. Install Playwright or set PLAYWRIGHT_MODULE to its entrypoint.
import assert from "node:assert/strict";
import {readFile, mkdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const browser = await chromium.launch({...process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {channel: "chrome"}, headless: true});
const output = path.join(root, "dist", "ui-check");
await mkdir(output, {recursive: true});
const A = "abcdefghijk", B = "lmnopqrstuv";
const record = id => ({videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: `A practical guide to thoughtful work ${id}`, channel: "Example channel",
  createdAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z", durationSeconds: 1800, transcriptLanguage: "English", transcriptIsGenerated: true,
  preview: {one_sentence_summary: "Reduce distractions by choosing a concrete next step and giving it a protected place in your day.", worth_watching: "Useful for people who want practical starting points for focused work, with concrete examples rather than a research review.", level: "beginner", useful_content_density: "high", content_type: "Explainer",
    full_summary: "Start by defining a clear next action. The speaker illustrates how smaller commitments make it easier to begin.\n\nProtect a short period for that action and review what worked afterward.",
    key_takeaways: [{text: "Choose one concrete action instead of a broad intention.", timestamp_seconds: 42, source: {segmentId: "S3", startSeconds: 42, text: "Write the first paragraph rather than telling yourself to work on the project."}}]}});
let checks = 0;
async function fixture(seed = {}, colorScheme = "light", width = 400) {
  const context = await browser.newContext({viewport: {width, height: 820}, colorScheme, reducedMotion: "reduce"});
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    const relative = decodeURIComponent(url.pathname).replace(/^\//, "");
    if (relative.includes("..")) return route.abort();
    try {
      const body = await readFile(path.join(root, "extension", relative));
      const ext = path.extname(relative);
      return route.fulfill({body, contentType: {".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml"}[ext] || "application/octet-stream"});
    } catch { return route.fulfill({status: 404, body: "Missing fixture resource"}); }
  });
  await context.addInitScript(({seed, A, B}) => {
    const listeners = () => ({items: [], addListener(fn) { this.items.push(fn); }, removeListener() {}});
    const changed = listeners();
    const state = {apiKey: "fixture-key", summaries: {}, jobs: {}, ...seed};
    if (sessionStorage.getItem("onboardingDismissed")) state.onboardingDismissed = true;
    const messages = []; let activeId = B;
    const emit = (key, value) => {
      const oldValue = state[key]; state[key] = structuredClone(value);
      for (const fn of changed.items) fn({[key]: {oldValue, newValue: value}}, "local");
    };
    window.fixture = {state, messages, emit, activate(id) { activeId = id; for (const fn of chrome.tabs.onActivated.items) fn(); }};
    window.chrome = {storage: {onChanged: changed, local: {async get(defaults = {}) { return structuredClone({...defaults, ...state}); }, async set(patch) { for (const [key, value] of Object.entries(patch)) { emit(key, value); if (key === "onboardingDismissed" && value) sessionStorage.setItem(key, "true"); } }}},
      tabs: {onActivated: listeners(), onUpdated: listeners(), async query(filter = {}) { const tabs = [A, B].map((id, i) => ({id: i + 1, active: id === activeId, url: `https://www.youtube.com/watch?v=${id}`})); return filter.active ? tabs.filter(tab => tab.active) : tabs; },
        async sendMessage(id) { return {context: {videoId: id === 1 ? A : B, title: "The active video", channel: "Example channel", durationSeconds: 1800, captionTracks: [{languageCode: "en", name: "English", kind: "asr"}, {languageCode: "fr", name: "French", kind: null}]}}; }},
      runtime: {async sendMessage(message) {
        messages.push(message);
        if (message.type === "VALIDATE_SETTINGS") return {ok: true, message: "Key and model access verified."};
        if (message.type === "START_JOB") { const id = "fixture-job"; emit("jobs", {...state.jobs, [id]: {id, videoId: message.videoId, title: "Regenerating displayed video", createdAt: new Date().toISOString(), status: "running", progress: 65, transcriptReady: true}}); return {ok: true, jobId: id}; }
        if (message.type === "DISMISS_ERROR") { emit("jobs", {...state.jobs, [message.jobId]: {...state.jobs[message.jobId], dismissedAt: new Date().toISOString()}}); return {ok: true}; }
        if (message.type === "CANCEL_JOB") { emit("jobs", {...state.jobs, [message.jobId]: {...state.jobs[message.jobId], status: "cancelled"}}); return {ok: true}; }
        if (message.type === "DELETE_HISTORY") { const records = message.videoId ? [state.summaries[message.videoId]] : Object.values(state.summaries); const summaries = {...state.summaries}; for (const item of records) delete summaries[item.videoId]; emit("historyUndo", {records}); emit("summaries", summaries); return {ok: true, count: records.length}; }
        if (message.type === "UNDO_HISTORY") { const summaries = {...state.summaries}; for (const item of state.historyUndo?.records || []) summaries[item.videoId] ||= item; emit("summaries", summaries); emit("historyUndo", null); return {ok: true}; }
        return {ok: true};
      }}};
  }, {seed, A, B});
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost/sidepanel.html");
  await page.locator("#historyView:not(.hidden), #onboardingView:not(.hidden)").waitFor();
  return {page, context, errors};
}
async function layout(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "No horizontal overflow");
  const duplicates = await page.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map(e => e.id); return ids.length - new Set(ids).size; });
  assert.equal(duplicates, 0);
  const accessible = await page.evaluate(() => {
    const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    const luminance = color => { const c = rgb(color); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
    const bg = luminance(getComputedStyle(document.body).backgroundColor);
    const contrast = node => { const color = luminance(getComputedStyle(node).color); return (Math.max(color, bg) + .05) / (Math.min(color, bg) + .05); };
    return {body: contrast(document.body), muted: contrast(document.querySelector(".muted")), reduced: getComputedStyle(document.querySelector(".spinner") || document.body).animationName};
  });
  assert.ok(accessible.body >= 4.5 && accessible.muted >= 4.5, "Readable body and secondary-text contrast");
  assert.equal(accessible.reduced, "none");
  checks += 4;
}
try {
  for (const theme of ["light", "dark"]) for (const width of [200, 320, 400, 600]) {
    const f = await fixture({summaries: {[A]: record(A), [B]: record(B)}}, theme, width);
    await layout(f.page);
    assert.equal(await f.page.locator("#historyCount").textContent(), "2 saved");
    if (width === 400) await f.page.screenshot({path: path.join(output, `history-${theme}.png`), fullPage: true});
    await f.page.locator(".history-title").first().click();
    await f.page.locator("#fullSummarySection summary").click();
    await layout(f.page);
    if (width === 400) {
      await f.page.screenshot({path: path.join(output, `summary-${theme}.png`), fullPage: true});
      await f.page.evaluate(() => { document.body.style.zoom = "2"; }); await layout(f.page);
      await f.page.evaluate(() => { document.body.style.zoom = ""; });
    }
    await f.page.locator("#backToHistoryButton").click();
    await f.page.locator(".history-title").first().waitFor(); await layout(f.page);
    await f.page.locator("#settingsButton").click();
    await f.page.locator("#apiKey").waitFor(); await layout(f.page);
    if (width === 400) await f.page.screenshot({path: path.join(output, `settings-${theme}.png`), fullPage: true});
    await f.page.locator("#toggleKeyButton").click();
    await f.page.locator("#outputLanguage").fill("French");
    await f.page.getByText("You have unsaved changes.", {exact: true}).waitFor();
    await f.page.locator("#saveSettingsButton").click();
    await f.page.getByText("Saved. You're ready to summarize a video.", {exact: true}).waitFor();
    assert.equal(await f.page.locator("#apiKey").getAttribute("type"), "password");
    assert.equal(await f.page.evaluate(() => fixture.state.outputLanguage), "French");
    await layout(f.page); checks += 4;
    await f.page.locator("#categoriesSettings > summary").click();
    await f.page.locator(".category-editor summary").first().click(); await layout(f.page);
    await f.page.goto("http://localhost/options.html");
    await f.page.locator(".category-editor").first().waitFor({state: "attached"}); await layout(f.page);
    if (width === 600) await f.page.screenshot({path: path.join(output, `settings-page-${theme}.png`), fullPage: true});
    assert.deepEqual(f.errors, []); checks += 1;
    await f.context.close();
  }
  for (const theme of ["light", "dark"]) for (const width of [200, 320, 400, 600]) {
    const f = await fixture({summaries: {[B]: record(B)}, jobs: {
      failed: {id: "failed", videoId: A, title: "Decision Models: How Can A Model Be Better Without Generating Words?", status: "failed", createdAt: "2026-10-12T10:00:00Z", error: "Could not extract the transcript from YouTube's transcript panel. This video has no readable transcript. Check YouTube's description or try another captioned video."},
      working: {id: "working", videoId: B, title: "A practical guide to thoughtful work", status: "running", createdAt: new Date().toISOString(), progress: 5}
    }}, theme, width);
    const p = f.page;
    await layout(p);
    if (width === 400) await p.screenshot({path: path.join(output, `history-jobs-${theme}.png`), fullPage: true});
    await p.locator(".job-failed .job-review").click();
    await p.locator("#errorState:not(.hidden)").waitFor();
    assert.equal(await p.locator("#historyView").isVisible(), false);
    assert.equal(await p.locator("#errorHeading").textContent(), "Couldn’t read captions");
    assert.match(await p.locator("#errorVideoTitle").textContent(), /Decision Models/);
    assert.equal(await p.locator("#errorDetails").evaluate(e => e.open), false);
    await layout(p);
    if (width === 400) await p.screenshot({path: path.join(output, `error-${theme}.png`), fullPage: true});
    await p.locator("#errorDetails > summary").click(); await layout(p);
    await p.locator("#reloadVideoButton").click();
    assert.equal(await p.evaluate(() => fixture.messages.at(-1).type), "RELOAD_VIDEO");
    assert.equal(await p.locator("#retryButton").isVisible(), true);
    await p.locator("#backToHistoryButton").click();
    assert.equal(await p.locator(".job-failed").isVisible(), true);
    await p.locator(".job-processing .job-review").click();
    await p.locator("#loadingState:not(.hidden)").waitFor(); await layout(p);
    if (width === 400) await p.screenshot({path: path.join(output, `processing-${theme}.png`), fullPage: true});
    await p.locator("#backToHistoryButton").click();
    await p.locator("#historySearch").fill("no matching summary");
    await p.getByText("No videos match your search.", {exact: true}).waitFor();
    assert.equal(await p.locator("#historyCount").textContent(), "0 of 3");
    await layout(p);
    await p.locator("#historySearch").fill("");
    await p.locator(".job-failed .job-review").click();
    await p.locator("#discardErrorButton").click();
    assert.equal(await p.locator(".job-failed").count(), 0);
    assert.equal(await p.locator("#historyCount").textContent(), "1 saved · 1 processing");
    await p.evaluate(() => fixture.emit("jobs", {...fixture.state.jobs, working: {...fixture.state.jobs.working, status: "cancelled"}}));
    await p.locator(".job-processing").waitFor({state: "detached"});
    await p.locator(".history-delete").click();
    await p.getByText("Your summarized videos will appear here.", {exact: true}).waitFor();
    await p.locator("#undoHistoryButton").click();
    await p.locator(".history-title").waitFor();
    assert.equal(await p.locator("#historyCount").textContent(), "1 saved");
    assert.deepEqual(f.errors, []); checks += 11;
    await f.context.close();
  }
  const f = await fixture({summaries: {[A]: record(A), [B]: record(B)}});
  const p = f.page;
  assert.equal(await p.locator("#historyView").isVisible(), true); checks += 1;
  assert.equal(await p.locator(".history-card").count(), 2);
  await p.locator(".history-title").first().click();
  await p.locator("#fullSummarySection summary").click();
  assert.equal(await p.locator("#takeawaysSection").evaluate(e => e.open), false);
  await p.locator("#takeawaysSection summary").click();
  await p.locator(".takeaway .timestamp").click();
  assert.equal(await p.evaluate(() => fixture.messages.at(-1).videoId), A);
  await p.locator("#refreshButton").click();
  await p.locator("#loadingState:not(.hidden)").waitFor();
  assert.equal(await p.locator("#resultState").isVisible(), true);
  assert.equal(await p.locator("#fullSummarySection").evaluate(e => e.open), true);
  await p.locator("#stopJobButton").click();
  await p.getByText("Summary stopped", {exact: true}).waitFor();
  assert.equal(await p.locator("#errorHeading").evaluate(e => e === document.activeElement), true); checks += 1;
  assert.equal(await p.locator("#resultState").isVisible(), true);
  await p.locator("#backToHistoryButton").click();
  await p.locator("#settingsButton").click();
  await p.locator("#clearHistoryButton").click();
  assert.equal(await p.evaluate(() => Object.keys(fixture.state.summaries).length), 2);
  await p.locator("#confirmClearButton").click();
  assert.equal(await p.evaluate(() => Object.keys(fixture.state.summaries).length), 0);
  await p.locator("#undoManagedHistoryButton").click();
  assert.equal(await p.evaluate(() => Object.keys(fixture.state.summaries).length), 2);
  assert.deepEqual(f.errors, []); checks += 9;
  await f.context.close();
  for (const theme of ["light", "dark"]) for (const width of [200, 320, 400, 600]) {
    const first = await fixture({apiKey: "", summaries: {}}, theme, width);
    const page = first.page;
    assert.equal(await page.locator("#onboardingView").isVisible(), true);
    assert.equal(await page.locator("#historyView").isVisible(), false);
    assert.equal(await page.locator("#sampleButton").count(), 0);
    assert.equal(await page.locator("#onboardingIntroSlide").isVisible(), true);
    assert.equal(await page.locator("#onboardingSetupSlide").isVisible(), false);
    assert.equal(await page.locator(".onboarding-examples .onboarding-example").count(), 2);
    await layout(page);
    if (width === 400) await page.screenshot({path: path.join(output, `onboarding-how-it-works-${theme}.png`), fullPage: true});
    await page.locator("#onboardingNextButton").click();
    assert.equal(await page.locator("#onboardingHeading").evaluate(e => e === document.activeElement), true);
    await page.locator("#onboardingIntroButton").click();
    assert.equal(await page.locator("#onboardingIntroHeading").evaluate(e => e === document.activeElement), true);
    await page.locator("#onboardingSetupButton").click();
    assert.equal(await page.locator("#onboardingIntroSlide").isVisible(), false);
    assert.equal(await page.locator(".onboarding-faq details").count(), 4);
    await layout(page);
    if (width === 400) await page.screenshot({path: path.join(output, `onboarding-${theme}.png`), fullPage: true});
    for (const question of await page.locator(".onboarding-faq summary").all()) await question.click();
    await layout(page);
    await page.locator("#setupButton").click();
    await page.getByText("Enter your OpenAI API key first.", {exact: true}).waitFor();
    await page.locator("#onboardingView:not(.hidden)").waitFor();
    assert.equal(await page.locator("#onboardingHeading").evaluate(e => e === document.activeElement), true);
    await page.locator("#dismissOnboardingButton").click();
    await page.locator("#historyView:not(.hidden)").waitFor();
    await page.reload();
    await page.locator("#historyView:not(.hidden)").waitFor();
    assert.equal(await page.locator("#onboardingView").isVisible(), false);
    await page.locator("#settingsButton").click();
    await page.locator("#onboardingHelpButton").click();
    assert.equal(await page.locator("#onboardingIntroSlide").isVisible(), true);
    await page.locator("#onboardingNextButton").click();
    await page.locator("#onboardingApiKey").fill("fixture-new-key");
    await page.locator("#setupButton").click();
    await page.locator("#historyView:not(.hidden)").waitFor();
    assert.deepEqual(first.errors, []); checks += 14;
    await first.context.close();
  }
  console.log(`${checks} automated rendering/interaction assertions passed. Screenshots: ${output}`);
} finally { await browser.close(); }

