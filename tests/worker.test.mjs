import test from "node:test";
import assert from "node:assert/strict";
import {event, storage, scriptContext, run, summary, VIDEO_A, VIDEO_B} from "./helpers.mjs";
import {videoUrl, HISTORY_FORMAT, summaryConfiguration, DEFAULT_SETTINGS} from "../extension/shared.js";

function worker(seed = {}, tabList = [], {firefox = false} = {}) {
  const local = storage(seed); const calls = [];
  const tabs = {
    async query() { return structuredClone(tabList); },
    async get(id) { return tabList.find(tab => tab.id === id); },
    async update(id, patch) { calls.push({kind: "update", id, patch}); return Object.assign(tabList.find(tab => tab.id === id), patch); },
    async create(patch) { const tab = {id: 99, windowId: 1, ...patch}; tabList.push(tab); calls.push({kind: "create", ...patch}); return tab; },
    async remove(id) { calls.push({kind: "remove", id}); const index = tabList.findIndex(tab => tab.id === id); if (index >= 0) tabList.splice(index, 1); },
    async sendMessage(id, message) {
      calls.push({kind: "message", id, message});
      if (message.type === "GET_VIDEO_CONTEXT") return {ok: true, context: {videoId: VIDEO_A, url: videoUrl(VIDEO_A), title: "Saved A"}};
      return {ok: true};
    }
  };
  const chrome = {storage: {local}, tabs, windows: {
      async get(windowId) {
        calls.push({kind: "window-get", windowId});
        const owned = tabList.filter(tab => tab.windowId === windowId);
        if (!owned.length) throw new Error("Missing window");
        return {id: windowId, state: "minimized", tabs: structuredClone(owned)};
      },
      async update(windowId, patch) { calls.push({kind: "window-update", windowId, patch}); return {id: windowId, ...patch}; },
      async create(options) {
        calls.push({kind: "window", ...options});
        const tab = {id: 80, windowId: 7, url: options.url, pendingUrl: options.url};
        tabList.push(tab);
        return {id: 7, state: "normal", tabs: [tab]};
      }
    },
    sidebarAction: {async open() { calls.push({kind: "sidebar", action: "open"}); }, async toggle() { calls.push({kind: "sidebar", action: "toggle"}); }},
    action: {onClicked: event()},
    runtime: {getURL: value => `chrome-extension://test/${value}`, onInstalled: event(), onStartup: event(), onMessage: event(),
      async sendMessage() { return {ok: true, ready: true}; }}, alarms: {create() {}, onAlarm: event()}};
  if (!firefox) {
    chrome.sidePanel = {async setPanelBehavior() {}, async open(options) { calls.push({kind: "panel", options}); }};
    chrome.offscreen = {async createDocument() { throw new Error("Unexpected offscreen document creation"); }};
    chrome.runtime.getContexts = async () => [{}];
  }
  const context = scriptContext("service-worker.js", {chrome});
  return {context, local, calls, chrome, async message(message, sender = {url: "chrome-extension://test/sidepanel.html"}) {
    return new Promise(resolve => {
      const accepted = chrome.runtime.onMessage.listeners[0](message, sender, resolve);
      if (accepted === false) resolve(null);
    });
  }};
}

test("takeaways target the saved video even when another video is active", async () => {
  const w = worker({}, [{id: 1, windowId: 1, url: videoUrl(VIDEO_B), active: true}, {id: 2, windowId: 1, url: videoUrl(VIDEO_A), active: false}]);
  await run(w.context, `seekSummary('${VIDEO_A}', 42)`);
  assert.equal(w.calls.find(call => call.kind === "message").id, 2);
  assert.equal(w.calls.find(call => call.kind === "message").message.expectedVideoId, VIDEO_A);
  assert.ok(!w.calls.some(call => call.id === 1));
});

test("a closed saved video opens at its own timestamp when the content script is unavailable", async () => {
  const w = worker({}, [{id: 1, windowId: 1, url: videoUrl(VIDEO_B)}]);
  w.chrome.tabs.sendMessage = async () => { throw new Error("No receiver"); };
  await run(w.context, `seekSummary('${VIDEO_A}', 42)`);
  assert.equal(w.calls.find(call => call.kind === "create").url, videoUrl(VIDEO_A));
  assert.equal(w.calls.find(call => call.kind === "update").patch.url, videoUrl(VIDEO_A, 42));
});

test("regenerate requests context from the saved video's tab", async () => {
  const w = worker({apiKey: "test"}, [{id: 1, windowId: 1, url: videoUrl(VIDEO_B), active: true}, {id: 2, windowId: 1, url: videoUrl(VIDEO_A)}]);
  const response = await w.message({type: "START_JOB", videoId: VIDEO_A, forceRefresh: true});
  assert.ok(response.ok, response.error);
  assert.equal(w.local.state.jobs[response.jobId].videoId, VIDEO_A);
  assert.equal(w.local.state.jobs[response.jobId].sourceTabId, 2);
  assert.equal(w.calls.find(call => call.kind === "message").id, 2);
});

test("changing length bypasses cached summaries and snapshots only generation configuration", async () => {
  const w = worker({apiKey: "private", summaryLength: "brief", summaries: {[VIDEO_A]: summary()}}, []);
  w.context.context = {videoId: VIDEO_A, url: videoUrl(VIDEO_A)};
  const response = await run(w.context, "startJob(2, context)");
  assert.equal(response.reused, false);
  assert.equal(w.local.state.jobs[response.jobId].configuration.summaryLength, "brief");
  assert.equal("apiKey" in w.local.state.jobs[response.jobId].configuration, false);
});

test("history deletion, undo, imports, and job completion share one mutation queue", async () => {
  const jobId = "job-b";
  const w = worker({summaries: {[VIDEO_A]: summary()}, jobs: {[jobId]: {id: jobId, status: "running"}}});
  w.context.completedSummary = summary(VIDEO_B);
  const [deleted, completed] = await Promise.all([
    w.message({type: "DELETE_HISTORY", videoId: VIDEO_A}),
    run(w.context, `completeJob('${jobId}', completedSummary)`)
  ]);
  assert.ok(deleted.ok); assert.ok(completed.accepted);
  assert.equal(w.local.state.summaries[VIDEO_A], undefined);
  assert.ok(w.local.state.summaries[VIDEO_B]);
  const imported = await w.message({type: "IMPORT_HISTORY", payload: {format: HISTORY_FORMAT, version: 1, summaries: [summary(VIDEO_A, {updatedAt: "2026-10-12T12:00:00Z"})]}});
  assert.ok(imported.ok);
  await w.message({type: "UNDO_HISTORY"});
  assert.equal(w.local.state.summaries[VIDEO_A].updatedAt, "2026-10-12T12:00:00Z");
  assert.ok(w.local.state.summaries[VIDEO_B]);
  assert.equal(w.local.state.historyUndo, null);
});

test("credential validation distinguishes invalid keys from model-access failures", async () => {
  const w = worker();
  for (const status of [401, 403, 404, 429]) {
    w.context.fetch = async () => ({ok: false, status});
    const result = await w.message({type: "VALIDATE_SETTINGS", settings: {apiKey: "test"}});
    assert.equal(result.ok, false);
    assert.match(result.error, status === 401 ? /rejected this key/ : status === 429 ? /rate limiting/ : /cannot access/);
  }
  w.context.fetch = async () => ({ok: true});
  assert.equal((await w.message({type: "VALIDATE_SETTINGS", settings: {apiKey: "test"}})).ok, true);
});

test("regeneration replaces the summary and failed completion cannot replace it", async () => {
  const w = worker({summaries: {[VIDEO_A]: summary()}, jobs: {regen: {id: "regen", videoId: VIDEO_A, status: "running"}, failed: {id: "failed", videoId: VIDEO_A, status: "failed"}}});
  w.context.nextSummary = summary(VIDEO_A, {title: "New summary"});
  await run(w.context, "completeJob('regen', nextSummary)");
  assert.equal(w.local.state.summaries[VIDEO_A].title, "New summary");
  w.context.badSummary = summary(VIDEO_A, {title: "Should never replace"});
  assert.equal((await run(w.context, "completeJob('failed', badSummary)")).accepted, false);
  assert.equal(w.local.state.summaries[VIDEO_A].title, "New summary");
});

function playerSender(id = 2, videoId = VIDEO_A) {
  return {frameId: 0, url: videoUrl(videoId), tab: {id, windowId: 4, url: videoUrl(videoId)}};
}

test("the embedded button opens history immediately and starts in the sender tab", async () => {
  const w = worker({apiKey: "test"}, [{id: 1, url: videoUrl(VIDEO_A)}, {id: 2, url: videoUrl(VIDEO_A)}]);
  const request = w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A, tabId: 1}, playerSender());
  assert.equal(w.calls[0].kind, "panel", "Open side panel before asynchronous context or storage work");
  const response = await request;
  assert.ok(response.ok, response.error);
  assert.equal(w.local.state.jobs[response.jobId].sourceTabId, 2);
  const repeated = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, playerSender());
  assert.equal(repeated.jobId, response.jobId);
  assert.equal(Object.keys(w.local.state.jobs).length, 1);
});

test("missing credentials open history for setup without creating a job", async () => {
  const w = worker({}, [{id: 2, url: videoUrl(VIDEO_A)}]);
  const response = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, playerSender());
  assert.equal(response.ok, false);
  assert.match(response.error, /API key/);
  assert.equal(w.calls[0].kind, "panel");
  assert.equal(Object.keys(w.local.state.jobs || {}).length, 0);
});

test("player messages reject mismatched videos, subframes, and privileged requests", async () => {
  const w = worker({apiKey: "secret"}, [{id: 2, url: videoUrl(VIDEO_A)}]);
  const mismatch = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_B}, playerSender());
  assert.equal(mismatch.ok, false);
  const frame = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, {...playerSender(), frameId: 1});
  assert.equal(frame.ok, false);
  assert.equal(await w.message({type: "GET_SETTINGS", target: "service-worker"}, playerSender()), null);
  assert.equal(w.calls.length, 0);
});

test("the player receives progress without settings, transcripts, or other videos", async () => {
  const w = worker({apiKey: "secret", jobs: {work: {id: "work", videoId: VIDEO_A, status: "running", stage: "Writing summary", configuration: {model: "private"}}}, summaries: {[VIDEO_B]: summary(VIDEO_B)}});
  const response = await w.message({type: "GET_PLAYER_STATUS", videoId: VIDEO_A}, playerSender());
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {ok: true, status: "running", stage: "Writing summary"});
});

test("navigation after the player click cannot summarize a different video", async () => {
  const w = worker({apiKey: "test"}, [{id: 2, url: videoUrl(VIDEO_B)}]);
  const response = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, playerSender());
  assert.equal(response.ok, false);
  assert.match(response.error, /changed video/);
  assert.equal(Object.keys(w.local.state.jobs || {}).length, 0);
});

function thumbnailSender(overrides = {}) {
  return {frameId: 0, url: "https://www.youtube.com/", tab: {id: 2, windowId: 4, url: "https://www.youtube.com/"}, ...overrides};
}

test("thumbnail clicks start from the feed, open history immediately, and deduplicate", async () => {
  const w = worker({apiKey: "test"}, [{id: 2, url: "https://www.youtube.com/", active: true}]);
  const request = w.message({type: "START_THUMBNAIL_JOB", videoId: VIDEO_A, title: "Feed video", tabId: 1}, thumbnailSender());
  assert.equal(w.calls[0].kind, "panel");
  const result = await request;
  assert.ok(result.ok, result.error);
  const job = w.local.state.jobs[result.jobId];
  assert.equal(job.fromThumbnail, true);
  assert.equal(job.thumbnailTabId, 2);
  assert.equal(job.sourceTabId, null, "Never extract the home feed as if it were the video");
  assert.equal(w.local.state.tabBindings["2"], undefined, "A thumbnail click does not bind the feed as a transcript source");
  assert.equal(job.title, "Feed video");
  assert.equal(w.calls.some(call => call.kind === "create"), false, "Create a tab only when extraction starts");
  const repeat = await w.message({type: "START_THUMBNAIL_JOB", videoId: VIDEO_A}, thumbnailSender());
  assert.equal(repeat.jobId, result.jobId);
  assert.equal(Object.keys(w.local.state.jobs).length, 1);
});

test("thumbnail clicks reuse compatible history and fail setup without opening video tabs", async () => {
  const w = worker({apiKey: "test", summaries: {[VIDEO_A]: summary(VIDEO_A, {configuration: summaryConfiguration(DEFAULT_SETTINGS)})}});
  assert.equal((await w.message({type: "START_THUMBNAIL_JOB", videoId: VIDEO_A}, thumbnailSender())).reused, true);
  assert.equal(Object.keys(w.local.state.jobs || {}).length, 0);
  const missing = worker();
  assert.match((await missing.message({type: "START_THUMBNAIL_JOB", videoId: VIDEO_A}, thumbnailSender())).error, /API key/);
  assert.equal(missing.calls.some(call => call.kind === "create"), false);
});

test("thumbnail reuse preserves the watch tab's binding to its own video", async () => {
  for (const seed of [
    {summaries: {[VIDEO_A]: summary(VIDEO_A, {configuration: summaryConfiguration(DEFAULT_SETTINGS)})}},
    {jobs: {work: {id: "work", videoId: VIDEO_A, status: "running", configuration: summaryConfiguration(DEFAULT_SETTINGS)}}},
    {}
  ]) {
    const binding = {videoId: VIDEO_B, jobId: "watch-job", url: videoUrl(VIDEO_B)};
    const w = worker({apiKey: "test", ...seed, tabBindings: {2: binding}});
    assert.ok((await w.message({type: "START_THUMBNAIL_JOB", videoId: VIDEO_A}, thumbnailSender())).ok);
    assert.deepEqual(w.local.state.tabBindings["2"], binding);
  }
});

test("transcript routing ignores old thumbnail bindings, stale contexts, closed tabs, and pending navigation", async () => {
  const job = {id: "watch", videoId: VIDEO_A, sourceTabId: 2, status: "running"};
  const w = worker({jobs: {watch: job}, tabBindings: {2: {videoId: VIDEO_A}, 3: {videoId: VIDEO_A}},
    latestContexts: {4: {videoId: VIDEO_A}, 5: {videoId: VIDEO_A}}}, [
    {id: 0, url: "https://www.youtube.com/"}, {id: 2, url: videoUrl(VIDEO_B)},
    {id: 4, url: videoUrl(VIDEO_A), pendingUrl: videoUrl(VIDEO_B)}, {id: 5, url: videoUrl(VIDEO_A)}
  ]);
  const extracted = [];
  w.chrome.tabs.sendMessage = async id => {
    extracted.push(id);
    return {ok: true, transcript: {segments: [{text: "Right video", startSeconds: 0}]}};
  };
  const response = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "watch"});
  assert.ok(response.ok, response.error);
  assert.deepEqual(extracted, [5]);
  assert.equal(w.local.state.jobs.watch.sourceTabId, 5);
  w.context.job = {...job, sourceTabId: null};
  assert.deepEqual([...await run(w.context, "candidateTabsForJob(job, {tabBindings:{},latestContexts:{}})")], [5]);
});

test("thumbnail messages reject invalid videos, non-YouTube senders, and subframes", async () => {
  const w = worker();
  for (const [videoId, sender] of [
    ["invalid", thumbnailSender()],
    [VIDEO_A, thumbnailSender({url: "https://example.com/"})],
    [VIDEO_A, thumbnailSender({frameId: 1})]
  ]) {
    assert.equal((await w.message({type: "START_THUMBNAIL_JOB", videoId}, sender)).ok, false);
    assert.equal((await w.message({type: "GET_THUMBNAIL_STATUS", videoId}, sender)).ok, false);
  }
  assert.equal(w.calls.length, 0);
});

test("thumbnail status exposes only sanitized progress for its video", async () => {
  const w = worker({apiKey: "secret", jobs: {work: {videoId: VIDEO_A, status: "running", stage: "Reading captions", configuration: {apiKey: "private"}}}});
  const response = await w.message({type: "GET_THUMBNAIL_STATUS", videoId: VIDEO_A}, thumbnailSender());
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {ok: true, status: "running", stage: "Reading captions"});
});

async function thumbnailExtraction({existing = false, fail = false, takeOver = false} = {}) {
  const job = {id: "feed", videoId: VIDEO_A, fromThumbnail: true, status: "running", configuration: {captionLanguage: "fr"}};
  const w = worker({jobs: {feed: job}}, existing ? [{id: 3, url: videoUrl(VIDEO_A), active: true}] : []);
  const original = w.chrome.tabs.sendMessage;
  w.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type !== "EXTRACT_TRANSCRIPT") return original(id, message);
    w.calls.push({kind: "extract", id, message});
    if (takeOver) await w.chrome.tabs.update(id, {active: true});
    return fail ? {ok: false, error: "No readable captions"} : {ok: true, transcript: {segments: [{text: "Evidence", startSeconds: 0}]}};
  };
  const result = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"});
  return {w, result};
}

test("feed extraction mutes before loading, pauses playback, reads the selected video, and closes its tab", async () => {
  const {w, result} = await thumbnailExtraction();
  assert.ok(result.ok, result.error);
  const changes = w.calls.filter(call => call.kind === "create" || call.kind === "update");
  assert.deepEqual(JSON.parse(JSON.stringify(changes.map(call => call.kind === "create" ? [call.url, call.active] : call.patch))), [
    ["about:blank", false], {muted: true}, {url: videoUrl(VIDEO_A)}
  ]);
  assert.equal(w.calls.find(call => call.kind === "message").message.pausePlayback, true);
  assert.equal(w.calls.find(call => call.kind === "extract").message.captionLanguage, "fr");
  assert.equal(w.calls.find(call => call.kind === "extract").message.expectedVideoId, VIDEO_A);
  assert.equal(w.calls.at(-1).kind, "remove");
  assert.equal(w.local.state.jobs.feed.title, "Saved A");
  assert.equal(w.local.state.jobs.feed.temporaryTabId, null);
});

test("feed extraction cleans up on failure and preserves existing or user-activated tabs", async () => {
  const failed = await thumbnailExtraction({fail: true});
  assert.equal(failed.result.ok, false);
  assert.match(failed.result.error, /No readable captions/);
  assert.ok(failed.w.calls.some(call => call.kind === "remove"));
  for (const options of [{existing: true}, {takeOver: true}]) {
    const {w, result} = await thumbnailExtraction(options);
    assert.ok(result.ok, result.error);
    assert.equal(w.calls.some(call => call.kind === "remove"), false);
    if (options.existing) {
      assert.equal(w.calls.some(call => call.kind === "update" || call.kind === "create"), false);
      assert.equal(w.calls.find(call => call.kind === "message").message.pausePlayback, false);
    }
  }
});

test("a thumbnail fetches captions from the feed without loading a hidden watch page", async () => {
  const job = {id: "feed", videoId: VIDEO_A, thumbnailTabId: 2, fromThumbnail: true, status: "running", title: "Feed title"};
  const w = worker({jobs: {feed: job}}, [{id: 2, url: "https://www.youtube.com/", active: true}]);
  w.chrome.tabs.sendMessage = async (id, message) => {
    w.calls.push({kind: "message", id, message});
    assert.equal(id, 2);
    assert.equal(message.type, "EXTRACT_TRANSCRIPT_BY_ID");
    assert.equal(message.expectedVideoId, VIDEO_A);
    assert.equal(message.jobId, "feed");
    return {ok: true, transcript: {segments: [{text: "Thumbnail captions", startSeconds: 0}]}};
  };
  const result = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"});
  assert.ok(result.ok, result.error);
  assert.equal(result.transcript.segments[0].text, "Thumbnail captions");
  assert.equal(w.calls.length, 1, "No tab creation, navigation, playback, or player-readiness request");
  assert.equal(w.local.state.jobs.feed.transcriptRequestTabId, null);
});

test("thumbnail caption transport can use a different watch page and recover jobs created by the old version", async () => {
  const job = {id: "feed", videoId: VIDEO_A, fromThumbnail: true, status: "running"};
  const w = worker({jobs: {feed: job}}, [{id: 2, url: videoUrl(VIDEO_B), active: true}]);
  w.chrome.tabs.sendMessage = async (_id, message) => {
    assert.equal(message.type, "EXTRACT_TRANSCRIPT_BY_ID");
    assert.equal(message.expectedVideoId, VIDEO_A);
    return {ok: true, transcript: {segments: [{text: "Requested video", startSeconds: 0}]}};
  };
  assert.ok((await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"})).ok);
  assert.equal(w.calls.length, 0);
});

test("an existing hidden target tab does not force thumbnail extraction to wait for its player", async () => {
  const job = {id: "feed", videoId: VIDEO_A, thumbnailTabId: 2, fromThumbnail: true, status: "running"};
  const w = worker({jobs: {feed: job}}, [
    {id: 2, url: "https://www.youtube.com/", active: true}, {id: 3, url: videoUrl(VIDEO_A), active: false}
  ]);
  w.chrome.tabs.sendMessage = async (id, message) => {
    assert.equal(id, 2);
    assert.equal(message.type, "EXTRACT_TRANSCRIPT_BY_ID");
    return {ok: true, transcript: {segments: [{text: "Feed request", startSeconds: 0}]}};
  };
  assert.ok((await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"})).ok);
  assert.equal(w.calls.length, 0);
});

test("a rejected feed request falls back to the video-tab transport", async () => {
  const job = {id: "feed", videoId: VIDEO_A, thumbnailTabId: 2, fromThumbnail: true, status: "running"};
  const w = worker({jobs: {feed: job}}, [{id: 2, url: "https://www.youtube.com/", active: true}]);
  const original = w.chrome.tabs.sendMessage;
  w.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type === "EXTRACT_TRANSCRIPT_BY_ID") return {ok: false, error: "Endpoint unavailable"};
    if (message.type === "EXTRACT_TRANSCRIPT") return {ok: true, transcript: {segments: [{text: "Fallback captions", startSeconds: 0}]}};
    return original(id, message);
  };
  const result = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"});
  assert.ok(result.ok, result.error);
  assert.equal(result.transcript.segments[0].text, "Fallback captions");
  assert.equal(w.calls.find(call => call.kind === "remove").id, 99);
  assert.equal(w.local.state.jobs.feed.transcriptRequestTabId, null);
});

test("cancelling a feed caption request aborts only that job and cannot create a fallback tab", async () => {
  const job = {id: "feed", videoId: VIDEO_A, thumbnailTabId: 2, fromThumbnail: true, status: "running"};
  const w = worker({jobs: {feed: job}}, [{id: 2, url: "https://www.youtube.com/", active: true}]);
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  w.chrome.tabs.sendMessage = async (id, message) => {
    w.calls.push({kind: "message", id, message});
    if (message.type === "EXTRACT_TRANSCRIPT_BY_ID") {
      started();
      return new Promise(resolve => { finish = resolve; });
    }
    assert.equal(message.type, "CANCEL_TRANSCRIPT_BY_ID");
    assert.equal(message.jobId, "feed");
    finish({ok: false, error: "Cancelled"});
    return {ok: true};
  };
  const pending = w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"});
  await ready;
  await w.message({type: "CANCEL_JOB", jobId: "feed"});
  assert.equal((await pending).ok, false);
  assert.equal(w.calls.some(call => call.kind === "create" || call.kind === "remove"), false);
  assert.equal(w.local.state.jobs.feed.transcriptRequestTabId, null);
});

test("cancelling a feed job closes its temporary tab and leaves the home tab alone", async () => {
  const w = worker({jobs: {feed: {id: "feed", status: "running", videoId: VIDEO_A, sourceTabId: 99, temporaryTabId: 99}}}, [
    {id: 2, url: "https://www.youtube.com/", active: true}, {id: 99, url: videoUrl(VIDEO_A), active: false}
  ]);
  const result = await w.message({type: "CANCEL_JOB", jobId: "feed"});
  assert.ok(result.ok, result.error);
  assert.equal(w.local.state.jobs.feed.status, "cancelled");
  assert.equal(w.calls.find(call => call.kind === "remove").id, 99);
  assert.equal(w.calls.some(call => call.id === 2), false);
});

test("temporary cleanup preserves a tab navigated to another video", async () => {
  const w = worker({jobs: {feed: {id: "feed", status: "running", videoId: VIDEO_A, temporaryTabId: 99}}}, [
    {id: 99, url: videoUrl(VIDEO_B), active: false}
  ]);
  await w.message({type: "CANCEL_JOB", jobId: "feed"});
  assert.equal(w.calls.some(call => call.kind === "remove"), false);
});

test("temporary cleanup respects a pending navigation away from its initial blank page", async () => {
  const w = worker({jobs: {feed: {id: "feed", status: "running", videoId: VIDEO_A, temporaryTabId: 99}}}, [
    {id: 99, url: "about:blank", pendingUrl: "https://example.com/", active: false}
  ]);
  await w.message({type: "CANCEL_JOB", jobId: "feed"});
  assert.equal(w.calls.some(call => call.kind === "remove"), false);
});

test("restarted extraction reuses an already-created blank temporary tab", async () => {
  const job = {id: "feed", status: "running", videoId: VIDEO_A, temporaryTabId: 99, fromThumbnail: true};
  const w = worker({jobs: {feed: job}}, [{id: 99, url: "about:blank", active: false}]);
  const original = w.chrome.tabs.sendMessage;
  w.chrome.tabs.sendMessage = (id, message) => message.type === "EXTRACT_TRANSCRIPT"
    ? Promise.resolve({ok: true, transcript: {segments: [{text: "Evidence", startSeconds: 0}]}}) : original(id, message);
  const result = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "feed"});
  assert.ok(result.ok, result.error);
  assert.equal(w.calls.some(call => call.kind === "create"), false);
  assert.equal(w.calls.find(call => call.kind === "remove").id, 99);
});


test("discarding a failed job preserves summaries and terminal state", async () => {
  const w = worker({jobs: {failed: {id: "failed", videoId: VIDEO_A, status: "failed", error: "Request timed out"}}, summaries: {[VIDEO_A]: summary()}});
  const response = await w.message({type: "DISMISS_ERROR", jobId: "failed"});
  assert.ok(response.ok, response.error);
  assert.ok(w.local.state.jobs.failed.dismissedAt);
  assert.equal(w.local.state.jobs.failed.status, "failed");
  assert.ok(w.local.state.summaries[VIDEO_A]);
  const late = await run(w.context, `patchJob('failed', {status: 'running'})`);
  assert.equal(late.status, "failed");
  assert.ok(late.dismissedAt);
});

test("firefox summaries use the sidebar and a minimized worker window", async () => {
  const w = worker({apiKey: "test"}, [{id: 2, url: videoUrl(VIDEO_A)}], {firefox: true});
  w.chrome.action.onClicked.listeners[0]();
  assert.equal(w.calls.at(-1).action, "toggle");
  const request = w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, playerSender());
  assert.equal(w.calls.at(-1).kind, "sidebar");
  const response = await request;
  assert.ok(response.ok, response.error);
  const created = w.calls.find(call => call.kind === "window");
  assert.equal(created.type, "popup");
  assert.equal(created.state, "minimized");
  assert.equal(created.focused, false);
  assert.equal(created.url, "chrome-extension://test/offscreen.html");
  assert.equal(w.calls.find(call => call.kind === "window-update").patch.state, "minimized");
  assert.equal((await w.message({type: "ENSURE_OFFSCREEN"})).ok, true);
  assert.equal(w.calls.filter(call => call.kind === "window").length, 1);
});

test("chrome offscreen setup does not open a firefox worker window", async () => {
  const w = worker();
  assert.equal((await w.message({type: "ENSURE_OFFSCREEN"})).ok, true);
  assert.equal(w.calls.some(call => call.kind === "window"), false);
  assert.equal(w.chrome.action.onClicked.listeners.length, 0);
});

test("discard rejects active or missing jobs", async () => {
  const w = worker({jobs: {active: {id: "active", videoId: VIDEO_A, status: "running"}}});
  for (const jobId of ["active", "missing"]) {
    const response = await w.message({type: "DISMISS_ERROR", jobId});
    assert.equal(response.ok, false);
  }
  assert.equal(w.local.state.jobs.active.dismissedAt, undefined);
});

test("a player click before the video loads starts a job instead of waiting for player data", async () => {
  const w = worker({apiKey: "test"}, [{id: 2, url: videoUrl(VIDEO_A)}]);
  w.chrome.tabs.sendMessage = async (id, message) => {
    w.calls.push({kind: "message", id, message});
    return {ok: true, context: {videoId: VIDEO_A, url: videoUrl(VIDEO_A), title: "Loading", playerReady: false}};
  };
  const response = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, playerSender());
  assert.ok(response.ok, response.error);
  assert.equal(w.calls.filter(call => call.message?.type === "GET_VIDEO_CONTEXT").length, 1);
  assert.equal(w.local.state.jobs[response.jobId].status, "queued");
});

test("restarting from the player cancels the running job and starts a fresh one", async () => {
  const running = {id: "stuck", videoId: VIDEO_A, status: "running", sourceTabId: 2, configuration: summaryConfiguration({...DEFAULT_SETTINGS, apiKey: "test"})};
  const w = worker({apiKey: "test", jobs: {stuck: running}, summaries: {[VIDEO_A]: summary(VIDEO_A, {configuration: running.configuration})}}, [{id: 2, url: videoUrl(VIDEO_A)}]);
  const repeated = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A}, playerSender());
  assert.equal(repeated.reused, true, "A plain click still reuses the saved summary");
  const response = await w.message({type: "START_PLAYER_JOB", videoId: VIDEO_A, restart: true}, playerSender());
  assert.ok(response.ok, response.error);
  assert.notEqual(response.jobId, "stuck");
  assert.equal(response.reused, false, "A restart regenerates rather than reusing the saved summary");
  assert.equal(w.local.state.jobs.stuck.status, "cancelled");
  assert.ok(w.calls.some(call => call.id === 2 && call.message?.type === "CANCEL_TRANSCRIPT"));
  assert.equal(w.local.state.jobs[response.jobId].status, "queued");
});

test("transcript reading waits for a loading player, refreshes metadata, and retries", async () => {
  const job = {id: "early", videoId: VIDEO_A, status: "running", sourceTabId: 2, title: "Loading", captionTracks: [], configuration: {}};
  const w = worker({jobs: {early: job}}, [{id: 2, url: videoUrl(VIDEO_A)}]);
  let extracts = 0;
  w.chrome.tabs.sendMessage = async (id, message) => {
    if (message.type === "GET_VIDEO_CONTEXT") return {ok: true, context: {videoId: VIDEO_A, title: "Real title", channel: "Channel", durationSeconds: 60, captionTracks: [{languageCode: "en"}]}};
    if (message.type !== "EXTRACT_TRANSCRIPT") return {ok: true};
    return ++extracts === 1 ? {ok: false, code: "PLAYER_LOADING", error: "Still loading"} : {ok: true, transcript: {segments: [{text: "Captions", startSeconds: 0}]}};
  };
  const result = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId: "early"});
  assert.ok(result.ok, result.error);
  assert.equal(extracts, 2);
  assert.equal(w.local.state.jobs.early.title, "Real title");
  assert.equal(w.local.state.jobs.early.captionTracks.length, 1);
});

test("captions fetched by ID backfill a missing title or channel from YouTube metadata", async () => {
  const w = worker({apiKey: "test"}, [{id: 2, windowId: 1, url: "https://www.youtube.com/", active: true}]);
  w.chrome.tabs.sendMessage = async () => ({ok: true, transcript: {segments: [{startSeconds: 0, text: "Hi"}]}});
  const requested = [];
  w.context.fetch = async url => { requested.push(url); return {ok: true, json: async () => ({title: "Real title", author_name: "Real channel"})}; };
  const {jobId} = await w.message({type: "START_THUMBNAIL_JOB", videoId: VIDEO_A, title: "Feed title"}, thumbnailSender());
  assert.equal(w.local.state.jobs[jobId].title, "Feed title");
  assert.equal(w.local.state.jobs[jobId].channel, null);
  const response = await w.message({target: "service-worker", type: "GET_TRANSCRIPT", jobId});
  assert.ok(response.ok, response.error);
  assert.match(requested[0], /^https:\/\/www\.youtube\.com\/oembed\?/);
  assert.equal(w.local.state.jobs[jobId].title, "Feed title");
  assert.equal(w.local.state.jobs[jobId].channel, "Real channel");
});

test("saved summaries missing a title or channel are repaired once metadata is available", async () => {
  const w = worker({summaries: {
    [VIDEO_A]: summary(VIDEO_A, {title: "Untitled YouTube video", channel: ""}),
    [VIDEO_B]: summary(VIDEO_B, {title: "Kept", channel: ""})
  }});
  const requested = [];
  w.context.fetch = async url => { requested.push(url); return {ok: true, json: async () => ({title: "Real title", author_name: "Real channel"})}; };
  await run(w.context, "repairUntitledSummaries()");
  assert.equal(requested.length, 2);
  assert.equal(w.local.state.summaries[VIDEO_A].title, "Real title");
  assert.equal(w.local.state.summaries[VIDEO_A].channel, "Real channel");
  assert.equal(w.local.state.summaries[VIDEO_B].title, "Kept");
  assert.equal(w.local.state.summaries[VIDEO_B].channel, "Real channel");
});

test("a first install opens the welcome tour; updates do not", async () => {
  const w = worker();
  await w.chrome.runtime.onInstalled.listeners[0]({reason: "update"});
  assert.ok(!w.calls.some(call => call.kind === "create"));
  await w.chrome.runtime.onInstalled.listeners[0]({reason: "install"});
  assert.equal(w.calls.find(call => call.kind === "create").url, "chrome-extension://test/welcome.html");
});
