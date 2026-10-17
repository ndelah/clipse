import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../extension/content-script.js", import.meta.url), "utf8");

function fixture({direct = false, initiallyOpen = false, rows = true, cancel = false, userCloses = false} = {}) {
  const state = {open: initiallyOpen, rendered: false, opens: 0, closes: 0, fetches: 0};
  const controller = new AbortController();
  const closeButton = {
    matches: () => true,
    click: () => { state.open = false; state.closes += 1; }
  };
  const openButton = {
    matches: () => true,
    getBoundingClientRect: () => ({width: 100, height: 30}),
    click: () => { state.open = true; state.opens += 1; state.rendered = rows; }
  };
  const panel = {
    getAttribute: () => state.open ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN",
    getBoundingClientRect: () => ({width: state.open ? 300 : 0, height: state.open ? 600 : 0}),
    querySelector: () => closeButton
  };
  const segment = {
    querySelector: selector => ({textContent: selector.startsWith(".segment-timestamp") ? "0:02" : "A caption."})
  };
  let now = 0;
  const context = vm.createContext({
    window: {addEventListener() {}, postMessage() {}},
    document: {
      querySelector: selector => selector.includes("engagement-panel-searchable-transcript") ? panel : null,
      querySelectorAll: selector => {
        if (selector === "ytd-transcript-segment-renderer") return state.rendered ? [segment, {
          querySelector: selector => ({textContent: selector.startsWith(".segment-timestamp") ? "0:04" : "Next caption."})
        }] : [];
        return selector === "ytd-video-description-transcript-section-renderer button" ? [openButton] : [];
      }
    },
    location: {href: "https://www.youtube.com/watch?v=video"},
    Date: {now: () => (now += 1000)},
    URL, AbortController, DOMException, setTimeout, clearTimeout,
    controller,
    fetch: async (_url, options) => {
      state.fetches += 1;
      assert.equal(options.credentials, "include");
      if (!direct) throw new Error("Caption URL blocked");
      return {ok: true, json: async () => ({events: [
        {tStartMs: 2000, dDurationMs: 1500, segs: [{utf8: "A caption.\n"}]}
      ]})};
    },
    pause: async ms => {
      if (ms === 300) {
        if (userCloses) state.open = false;
        if (cancel) controller.abort();
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        if (initiallyOpen && rows) state.rendered = true;
      }
    }
  });
  panel.querySelectorAll = selector => context.document.querySelectorAll(selector);
  vm.runInContext(source, context);
  vm.runInContext(`
    latestContext = {videoId: "video", captionTracks: [{
      baseUrl: "https://www.youtube.com/api/timedtext?v=video", languageCode: "en", name: "English"
    }]};
    sleep = pause;
  `, context);
  return {
    state,
    extract: () => vm.runInContext('extractTranscriptFromPage({expectedVideoId: "video"}, controller.signal)', context)
  };
}

test("direct captions leave the transcript panel closed", async () => {
  const {state, extract} = fixture({direct: true});
  const transcript = await extract();
  assert.equal(transcript.source, "youtube_caption_json3");
  assert.equal(transcript.segments[0].startSeconds, 2);
  assert.equal(transcript.segments[0].durationSeconds, 1.5);
  assert.equal(transcript.segments[0].text, "A caption.");
  assert.equal(state.fetches, 1);
  assert.equal(state.opens, 0);
  assert.equal(state.closes, 0);
});

test("fallback closes the panel after collecting rows", async () => {
  const {state, extract} = fixture();
  const transcript = await extract();
  assert.equal(transcript.segments.length, 2);
  assert.equal(state.opens, 1);
  assert.equal(state.closes, 1);
  assert.equal(state.open, false);
});

test("an existing user-opened panel stays open while rows load", async () => {
  const {state, extract} = fixture({initiallyOpen: true});
  await extract();
  assert.equal(state.opens, 0);
  assert.equal(state.closes, 0);
  assert.equal(state.open, true);
});

test("extraction failure still closes the extension-opened panel", async () => {
  const {state, extract} = fixture({rows: false});
  await assert.rejects(extract(), /did not render transcript rows/);
  assert.equal(state.closes, 1);
  assert.equal(state.open, false);
});

test("cancellation still closes the extension-opened panel", async () => {
  const {state, extract} = fixture({cancel: true});
  await assert.rejects(extract(), {name: "AbortError"});
  assert.equal(state.closes, 1);
  assert.equal(state.open, false);
});

test("cached rendered rows are reused without opening the panel", async () => {
  const {state, extract} = fixture();
  state.rendered = true;
  await extract();
  assert.equal(state.opens, 0);
  assert.equal(state.closes, 0);
});

test("cleanup leaves a panel alone if the user already closed it", async () => {
  const {state, extract} = fixture({userCloses: true});
  await extract();
  assert.equal(state.opens, 1);
  assert.equal(state.closes, 0);
  assert.equal(state.open, false);
});
