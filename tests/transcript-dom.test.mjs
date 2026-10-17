import test from "node:test";
import assert from "node:assert/strict";
import {scriptContext, run, VIDEO_A} from "./helpers.mjs";
import {videoUrl} from "../extension/shared.js";

// Models the inline attributed text and untargeted panel used by modern YouTube.
// Markup reported at https://github.com/obsidianmd/obsidian-clipper/issues/946.
// There is deliberately no newline between the timestamp, accessibility label,
// and text: innerText splitting cannot recover these rows reliably.
function fixture({userOpened = false, textSelector = ".ytAttributedStringHost", direct = false} = {}) {
  let open = userOpened;
  const counts = {opens: 0, closes: 0, fetches: 0};
  const rows = [
    {time: "0:01", text: "First caption."},
    {time: "0:06", text: "Second caption."}
  ].map(({time, text}) => ({
    innerText: `${time}1 second${text}`,
    querySelector(selector) {
      const selectors = selector.split(", ");
      if (selectors.includes("[class*='Timestamp']")) return {textContent: time};
      if (selectors.includes(textSelector)) return {textContent: text};
      return null;
    }
  }));
  const close = {matches: () => true, click() { open = false; counts.closes++; }};
  const label = {textContent: "English (auto-generated)"};
  const panel = {
    getAttribute(name) { return name === "visibility" ? (open ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN") : null; },
    getBoundingClientRect: () => ({width: open ? 300 : 0, height: open ? 600 : 0}),
    querySelector(selector) {
      if (selector.includes("visibility-button")) return close;
      if (selector.includes("combobox")) return label;
      if (selector.includes("transcript-segment-view-model")) return open ? rows[0] : null;
      return null;
    },
    querySelectorAll(selector) { return open && selector === "transcript-segment-view-model" ? rows : []; }
  };
  const hiddenLegacy = {
    getAttribute: name => name === "target-id" ? "engagement-panel-searchable-transcript" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN",
    getBoundingClientRect: () => ({width: 0, height: 0}),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const button = {
    matches: () => true, getBoundingClientRect: () => ({width: 100, height: 30}),
    click() { open = true; counts.opens++; }
  };
  const failedClipse = {
    id: "clipse-summarize-button",
    getAttribute: () => "Clipse: Could not extract the transcript. Click to retry.",
    getBoundingClientRect: () => ({width: 40, height: 40})
  };
  const closeTranscript = {
    closest: () => panel,
    getAttribute: () => "Close transcript",
    getBoundingClientRect: () => ({width: 40, height: 40})
  };
  const document = {
    querySelector(selector) {
      if (selector.includes("engagement-panel-searchable-transcript")) return hiddenLegacy;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "ytd-engagement-panel-section-list-renderer") return [hiddenLegacy, panel];
      if (selector === "ytd-video-description-transcript-section-renderer button") return [button];
      if (selector === "button[aria-label*='transcript' i]") return [failedClipse, closeTranscript];
      return [];
    }
  };
  const controller = new AbortController();
  const context = scriptContext("content-script.js", {
    document, window: {addEventListener() {}, postMessage() {}},
    location: {href: videoUrl(VIDEO_A)}, controller,
    fetch: async () => {
      counts.fetches++;
      // Timedtext can respond HTTP 200 with an empty body, even with captions.
      return {ok: true, async json() {
        if (!direct) throw new SyntaxError("Unexpected end of JSON input");
        return {events: [{tStartMs: 0, segs: [{utf8: "Direct caption."}]}]};
      }};
    }
  });
  run(context, `sleep = async (_ms, signal) => {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  }; latestContext = {videoId: '${VIDEO_A}', captionTracks: [{
    baseUrl: 'https://www.youtube.com/api/timedtext?v=${VIDEO_A}',
    languageCode: 'en', name: 'English (auto-generated)', kind: 'asr'
  }]};`);
  return {context, document, controller, counts, panel, button,
    isOpen: () => open,
    extract: () => run(context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'}, controller.signal)`)};
}

for (const textSelector of [".ytAttributedStringHost", "[role='text']", ".yt-core-attributed-string"]) {
  test(`empty timedtext falls back to modern inline captions using ${textSelector}`, async () => {
    const f = fixture({textSelector});
    const transcript = await f.extract();
    assert.equal(transcript.source, "youtube_transcript_panel");
    assert.deepEqual(JSON.parse(JSON.stringify(transcript.segments)), [
      {startSeconds: 1, durationSeconds: 5, text: "First caption."},
      {startSeconds: 6, durationSeconds: 0, text: "Second caption."}
    ]);
    assert.equal(transcript.languageCode, "en");
    assert.equal(transcript.isGenerated, true);
    assert.equal(f.counts.fetches, 1);
    assert.equal(f.counts.opens, 1);
    assert.equal(f.counts.closes, 1);
    assert.equal(f.isOpen(), false);
  });
}

test("a visible untargeted panel wins over hidden legacy panels and stays open", async () => {
  const f = fixture({userOpened: true, direct: true});
  const transcript = await f.extract();
  assert.equal(transcript.segments[0].text, "First caption.");
  assert.equal(f.counts.fetches, 0);
  assert.equal(f.counts.opens, 0);
  assert.equal(f.counts.closes, 0);
  assert.equal(f.isOpen(), true);
});

test("transcript lookup ignores Clipse's failed control and the panel's close button", () => {
  const f = fixture({userOpened: true});
  const original = f.document.querySelectorAll;
  f.document.querySelectorAll = selector => selector.includes("transcript-section-renderer") ? [] : original(selector);
  assert.equal(run(f.context, "findTranscriptButton()"), null);
});

test("cancellation cleans up an untargeted transcript panel opened by Clipse", async () => {
  const f = fixture();
  const open = f.button.click;
  f.button.click = () => { open(); f.controller.abort(); };
  await assert.rejects(f.extract(), {name: "AbortError"});
  assert.equal(f.counts.closes, 1);
  assert.equal(f.isOpen(), false);
});

test("extraction waits for a delayed description and transcript button, then restores the description", async () => {
  const f = fixture();
  let now = 0, expanded = false, expands = 0, collapses = 0;
  const originalQuery = f.document.querySelector;
  const originalAll = f.document.querySelectorAll;
  f.context.Date = {now: () => now};
  f.context.pause = async ms => { now += ms; };
  run(f.context, "sleep = pause");
  f.document.querySelector = selector => {
    if (selector === "#description-inline-expander #expand" && now >= 550) return {
      matches: () => true, click() { expanded = true; expands++; }
    };
    if (selector.includes("#collapse") && expanded) return {
      matches: () => true, click() { expanded = false; collapses++; }
    };
    return originalQuery(selector);
  };
  f.document.querySelectorAll = selector => selector.includes("transcript-section-renderer") && (!expanded || now < 1150) ? [] : originalAll(selector);
  const result = await f.extract();
  assert.equal(result.segments.length, 2);
  assert.equal(expands, 1);
  assert.equal(collapses, 1);
  assert.equal(f.counts.opens, 1);
  assert.equal(f.counts.closes, 1);
});

test("a missing transcript action is an extraction failure rather than a claim of absent captions", async () => {
  const f = fixture();
  let now = 0;
  f.context.Date = {now: () => now};
  f.context.pause = async ms => { now += ms; };
  run(f.context, "sleep = pause");
  const original = f.document.querySelectorAll;
  f.document.querySelectorAll = selector => selector.includes("transcript-section-renderer") ? [] : original(selector);
  await assert.rejects(f.extract(), /Could not find YouTube's Show transcript control/);
  assert.ok(now >= 5000 && now < 6000);
  assert.equal(f.counts.opens, 0);
});

test("cancelling during description expansion restores it without opening a transcript", async () => {
  const f = fixture();
  let collapses = 0;
  f.document.querySelector = selector => {
    if (selector === "#description-inline-expander #expand") return {matches: () => true, click() { f.controller.abort(); }};
    if (selector.includes("#collapse")) return {matches: () => true, click() { collapses++; }};
    return null;
  };
  f.document.querySelectorAll = () => [];
  await assert.rejects(f.extract(), {name: "AbortError"});
  assert.equal(collapses, 1);
  assert.equal(f.counts.opens, 0);
});

test("description expansion skips hidden expanders left in the DOM", () => {
  const f = fixture();
  let hiddenClicks = 0, visibleClicks = 0;
  f.document.querySelector = selector => {
    if (selector === "#description-inline-expander #expand") return {
      matches: () => true, getBoundingClientRect: () => ({width: 0, height: 0}), click() { hiddenClicks++; }
    };
    if (selector === "ytd-text-inline-expander #expand") return {
      matches: () => true, getBoundingClientRect: () => ({width: 40, height: 20}), click() { visibleClicks++; }
    };
    return null;
  };
  assert.equal(run(f.context, "expandDescription()"), true);
  assert.equal(hiddenClicks, 0);
  assert.equal(visibleClicks, 1);
});
