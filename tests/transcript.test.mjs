import test from "node:test";
import assert from "node:assert/strict";
import {event, scriptContext, run, VIDEO_A, VIDEO_B} from "./helpers.mjs";
import {videoUrl} from "../extension/shared.js";

function transcriptFixture({userOpened = false, existingRows = false, abortOnOpen = false, fail = false} = {}) {
  let open = userOpened, hasRows = existingRows, opens = 0, closes = 0, played = false;
  const controller = new AbortController();
  const close = {matches: () => true, click() { open = false; closes += 1; }};
  const button = {getBoundingClientRect: () => ({width: 30, height: 20}), matches: () => true, click() {
    open = true; opens += 1; hasRows = !fail;
    if (abortOnOpen) controller.abort();
  }};
  const label = {textContent: "French", matches: () => true, click() {}};
  const panel = {getBoundingClientRect: () => ({width: open ? 300 : 0, height: open ? 600 : 0}), getAttribute: () => open ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN", querySelector(selector) {
    return selector.includes("combobox") ? label : close;
  }};
  const nodes = [0, 5].map(time => ({querySelector(selector) { return selector.includes("Timestamp") ? {textContent: `0:0${time}`} : {textContent: `Caption ${time}`}; }}));
  const video = {currentTime: 0, play() { played = true; return Promise.resolve(); }};
  const document = {
    querySelector(selector) {
      if (selector === "video") return video;
      if (selector.startsWith("ytd-engagement-panel")) return panel;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "ytd-transcript-segment-renderer") return hasRows ? nodes : [];
      if (selector.includes("transcript-section-renderer")) return [button];
      return [];
    }
  };
  panel.querySelectorAll = selector => document.querySelectorAll(selector);
  const chrome = {runtime: {id: "test", onMessage: event(), async sendMessage() { return {ok: true}; }}};
  const context = scriptContext("content-script.js", {chrome, document, window: {addEventListener() {}, removeEventListener() {}, postMessage() {}},
    location: {href: videoUrl(VIDEO_A)}, controller});
  run(context, `latestContext = {videoId: '${VIDEO_A}', captionTracks: [{name: 'English', languageCode: 'en', kind: 'asr'}, {name: 'French', languageCode: 'fr', kind: null}]}`);
  if (fail) run(context, 'waitForTranscriptSegments = async () => { throw new Error("Transcript timed out"); }');
  return {context, chrome, controller, video, counts: () => ({opens, closes, open, played})};
}

test("already-rendered captions are reused without opening YouTube's panel", async () => {
  const f = transcriptFixture({existingRows: true});
  const result = await run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'}, controller.signal)`);
  assert.equal(result.segments.length, 2);
  assert.equal(f.counts().opens, 0);
  assert.equal(f.counts().closes, 0);
});

test("background context acquisition pauses only the requested video", async () => {
  const f = transcriptFixture();
  let paused = 0;
  f.video.pause = () => { paused++; };
  const listener = f.chrome.runtime.onMessage.listeners[0];
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  await send({type: "GET_VIDEO_CONTEXT", pausePlayback: true, expectedVideoId: VIDEO_B});
  assert.equal(paused, 0);
  await send({type: "GET_VIDEO_CONTEXT", expectedVideoId: VIDEO_A});
  assert.equal(paused, 0);
  await send({type: "GET_VIDEO_CONTEXT", pausePlayback: true, expectedVideoId: VIDEO_A});
  assert.equal(paused, 1);
});

test("Clipse closes the transcript it opens immediately after reading it and reports its actual language", async () => {
  const f = transcriptFixture();
  const result = await run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'}, controller.signal)`);
  assert.equal(result.languageCode, "fr");
  assert.equal(result.isGenerated, false);
  assert.deepEqual(f.counts(), {opens: 1, closes: 1, open: false, played: false});
});

test("a transcript panel already opened by the user stays open", async () => {
  const f = transcriptFixture({userOpened: true, existingRows: true});
  await run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'}, controller.signal)`);
  assert.deepEqual(f.counts(), {opens: 0, closes: 0, open: true, played: false});
});

for (const scenario of [{name: "cancellation", abortOnOpen: true}, {name: "extraction failure", fail: true}]) {
  test(`Clipse cleans up its transcript panel on ${scenario.name}`, async () => {
    const f = transcriptFixture(scenario);
    await assert.rejects(run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'}, controller.signal)`));
    assert.equal(f.counts().closes, 1);
    assert.equal(f.counts().open, false);
  });
}

test("missing language metadata stays unknown instead of guessing from preferred tracks", () => {
  const f = transcriptFixture();
  f.context.document.querySelector = () => null;
  const result = run(f.context, "selectedTranscriptMetadata()");
  assert.equal(result.languageCode, "unknown");
  assert.equal(result.isGenerated, null);
});

test("the content script refuses a seek for a different video", async () => {
  const f = transcriptFixture();
  const response = await new Promise(resolve => f.chrome.runtime.onMessage.listeners[0]({type: "SEEK_VIDEO", expectedVideoId: VIDEO_B, seconds: 42}, {}, resolve));
  assert.equal(response.ok, false);
  assert.equal(f.video.currentTime, 0);
  assert.equal(f.counts().played, false);
});

test("an explicit caption choice is verified against the rendered panel", async () => {
  const f = transcriptFixture({userOpened: true, existingRows: true});
  const result = await run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}',captionLanguage:'fr:manual'}, controller.signal)`);
  assert.equal(result.languageCode, "fr");
  assert.equal(result.isGenerated, false);
  assert.equal(f.counts().closes, 0);
});

test("unavailable caption choices fail rather than silently summarizing another language", async () => {
  const f = transcriptFixture({existingRows: true});
  await assert.rejects(run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}',captionLanguage:'de:manual'}, controller.signal)`), /requested captions are unavailable/);
});

test("a mismatched rendered language cannot be mislabeled as the requested track", async () => {
  const f = transcriptFixture({userOpened: true, existingRows: true});
  run(f.context, 'sleep = async () => {}');
  await assert.rejects(run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}',captionLanguage:'en:asr'}, controller.signal)`), /requested caption language|select these captions/);
});

test("direct caption requests use the explicitly selected track", async () => {
  const f = transcriptFixture();
  const requests = [];
  f.context.fetch = async url => { requests.push(url); return {ok: true, async json() { return {events: [{tStartMs: 1000, segs: [{utf8: "Texte français"}]}]}; }}; };
  run(f.context, `latestContext.captionTracks[1].baseUrl = 'https://www.youtube.com/api/timedtext?v=${VIDEO_A}&lang=fr'`);
  const result = await run(f.context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}',captionLanguage:'fr:manual'}, controller.signal)`);
  assert.equal(new URL(requests[0]).searchParams.get("lang"), "fr");
  assert.equal(result.languageCode, "fr");
  assert.equal(result.segments[0].text, "Texte français");
  assert.equal(f.counts().opens, 0);
});
