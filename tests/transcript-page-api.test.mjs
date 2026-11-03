import test from "node:test";
import assert from "node:assert/strict";
import {scriptContext, run, VIDEO_A, VIDEO_B, settle, event} from "./helpers.mjs";
import {videoUrl} from "../extension/shared.js";

// Model both the legacy endpoint and the modern PAmodern timeline response.
function pageFixture({videoId = VIDEO_A, endpointVideoId = videoId, blocked = false, modern = false, pending = false, url = videoUrl(videoId)} = {}) {
  const sent = [], requests = [], listeners = [], timers = new Map();
  const window = {
    ytInitialPlayerResponse: {videoDetails: {videoId}, captions: {playerCaptionsTracklistRenderer: {captionTracks: [
      {languageCode: "en", name: {simpleText: "English"}}
    ]}}},
    ytInitialData: {currentVideoEndpoint: {watchEndpoint: {videoId: endpointVideoId}}, engagementPanels: [
      {engagementPanelSectionListRenderer: {content: {continuationItemRenderer: {
        continuationEndpoint: {getTranscriptEndpoint: {params: "page-provided-params"}}
      }}}}
    ]},
    ytcfg: {get: key => key === "INNERTUBE_CONTEXT" ? {client: {clientName: "WEB", clientVersion: "current-page-version"}} : null},
    addEventListener(type, callback) { if (type === "message") listeners.push(callback); },
    postMessage(message) { sent.push(message); }
  };
  const context = scriptContext("page-context.js", {
    window, btoa, TextEncoder, location: {href: url, origin: "https://www.youtube.com"},
    document: {title: "Video - YouTube", querySelector: () => null, getElementById: () => null, addEventListener() {}},
    setTimeout(fn, ms) { if (ms === 300 || ms === 1500) fn(); else timers.set(fn, ms); return fn; },
    clearTimeout(fn) { timers.delete(fn); },
    fetch: async (url, options) => {
      requests.push({url, options});
      if (pending) return await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), {once: true}));
      if (modern && !blocked) return {ok: true, json: async () => ({content: {engagementPanelSectionListRenderer: {content: {sectionListRenderer: {contents: [
        {itemSectionRenderer: {contents: [
          {macroMarkersPanelItemViewModel: {item: {timelineItemViewModel: {contentItems: [
            {transcriptSegmentViewModel: {simpleText: "Second caption.", timestamp: "0:05"}},
            {transcriptSegmentViewModel: {simpleText: "First caption.\n", timestamp: "0:01"}},
            {transcriptSegmentViewModel: {simpleText: "No timestamp must be discarded"}}
          ]}}}}
        ]}}
      ]}}}}})};
      return {ok: !blocked && url.endsWith("get_transcript"), json: async () => ({actions: [{updateEngagementPanelAction: {content: {transcriptRenderer: {
        body: {transcriptSegmentListRenderer: {initialSegments: [
          modern ? {transcriptSegmentViewModel: {startMs: "5000", endMs: "8000", text: {content: "Second caption."}}}
            : {transcriptSegmentRenderer: {startMs: "5000", endMs: "8000", snippet: {runs: [{text: "Second caption."}]}}},
          {transcriptSectionHeaderRenderer: {startMs: "0", snippet: {simpleText: "Not a caption"}}},
          {transcriptSegmentRenderer: {startMs: "1000", endMs: "5000", snippet: {runs: [{text: "First "}, {text: "caption.\n"}]}}}
        ]}},
        footer: {transcriptFooterRenderer: {languageMenu: {sortFilterSubMenuRenderer: {subMenuItems: [{title: "English", selected: true}]}}}}
      }}}}]})};
    }
  });
  const deliver = message => listeners.forEach(callback => callback({source: window, data: {source: "video-preview-content-script", ...message}}));
  return {window, context, sent, requests, timers, deliver};
}

for (const modern of [false, true]) {
  test(`the page bridge reads ${modern ? "modern" : "legacy"} transcript JSON using its own endpoint and context`, async () => {
    const f = pageFixture({modern});
    assert.equal(f.sent[0].payload.hasTranscriptEndpoint, true);
    f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "request-1"});
    await settle();
    const result = f.sent.find(message => message.type === "TRANSCRIPT_RESULT");
    assert.equal(result.videoId, VIDEO_A);
    assert.equal(result.transcript.languageCode, modern ? "unknown" : "en");
    assert.equal(result.transcript.isGenerated, modern ? null : false);
    assert.deepEqual(JSON.parse(JSON.stringify(result.transcript.segments)), [
      {startSeconds: 1, durationSeconds: 4, text: "First caption."},
      {startSeconds: 5, durationSeconds: modern ? 0 : 3, text: "Second caption."}
    ]);
    assert.equal(f.requests[0].url, "/youtubei/v1/get_panel");
    assert.equal(f.requests.length, modern ? 1 : 2);
    assert.equal(f.requests[0].options.credentials, "include");
    const body = JSON.parse(f.requests[0].options.body);
    assert.equal(body.panelId, "PAmodern_transcript_view");
    assert.deepEqual([...Buffer.from(body.params, "base64url")], [0xaa, 0x09, 0x0f, 0x0a, 0x0b, ...Buffer.from(VIDEO_A), 0x18, 0x02]);
    if (!modern) assert.deepEqual(JSON.parse(f.requests[1].options.body), {
      context: {client: {clientName: "WEB", clientVersion: "current-page-version"}}, params: "page-provided-params"
    });
    assert.equal(f.timers.size, 0);
  });
}

test("stale legacy endpoints are ignored and requests for a different video never fetch transcripts", async () => {
  for (const options of [{endpointVideoId: VIDEO_B}, {}]) {
    const f = pageFixture(options);
    f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: options.endpointVideoId ? VIDEO_A : VIDEO_B, requestId: "stale"});
    await settle();
    assert.equal(f.requests.length, options.endpointVideoId ? 1 : 0);
    assert.ok(f.requests.every(request => request.url.endsWith("get_panel")), "Never use stale legacy params");
    assert.equal(f.sent.at(-1).transcript, null);
  }
});

test("modern transcripts work without legacy engagement panels or ytcfg.get", async () => {
  const f = pageFixture({modern: true});
  f.window.ytInitialData = null;
  f.window.ytcfg = {data_: {INNERTUBE_CONTEXT: {client: {clientName: "WEB", clientVersion: "page-version"}}}};
  f.deliver({type: "REQUEST_VIDEO_CONTEXT"});
  assert.equal(f.sent.at(-1).payload.hasTranscriptEndpoint, false);
  assert.equal(f.sent.at(-1).payload.canFetchTranscript, true);
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "no-legacy"});
  await settle();
  assert.equal(f.sent.at(-1).transcript.segments.length, 2);
  assert.equal(f.requests.length, 1);
});

test("a feed page can request a thumbnail's captions by ID without any player or video data", async () => {
  const f = pageFixture({url: "https://www.youtube.com/", modern: true});
  f.window.ytInitialPlayerResponse = null;
  f.window.ytInitialData = null;
  f.deliver({type: "REQUEST_TRANSCRIPT_BY_ID", expectedVideoId: VIDEO_B, requestId: "feed"});
  await settle();
  assert.equal(f.sent.at(-1).videoId, VIDEO_B);
  assert.equal(f.sent.at(-1).transcript.segments.length, 2);
  const params = JSON.parse(f.requests[0].options.body).params;
  assert.deepEqual([...Buffer.from(params, "base64url").subarray(5, 16)], [...Buffer.from(VIDEO_B)]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
});

test("by-ID requests never reuse the current video's legacy command or language metadata", async () => {
  const f = pageFixture();
  f.deliver({type: "REQUEST_TRANSCRIPT_BY_ID", expectedVideoId: VIDEO_B, requestId: "other-video"});
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.sent.at(-1).transcript, null);
  const modern = pageFixture({modern: true});
  modern.deliver({type: "REQUEST_TRANSCRIPT_BY_ID", expectedVideoId: VIDEO_B, requestId: "language"});
  await settle();
  assert.equal(modern.sent.at(-1).transcript.languageCode, "unknown");
  assert.equal(modern.sent.at(-1).transcript.isGenerated, null);
  // Even a response labelled English cannot borrow the host video's English track.
  const labelled = pageFixture();
  const original = labelled.context.fetch;
  labelled.context.fetch = (_url, options) => original("/youtubei/v1/get_transcript", options);
  labelled.deliver({type: "REQUEST_TRANSCRIPT_BY_ID", expectedVideoId: VIDEO_B, requestId: "labelled"});
  await settle();
  assert.equal(labelled.sent.at(-1).transcript.language, "English");
  assert.equal(labelled.sent.at(-1).transcript.languageCode, "unknown");
  assert.equal(labelled.sent.at(-1).transcript.isGenerated, null);
});

test("legacy endpoint discovery also searches the current description data", async () => {
  const f = pageFixture();
  const panels = f.window.ytInitialData.engagementPanels;
  delete f.window.ytInitialData.engagementPanels;
  f.window.ytInitialData.contents = {description: panels};
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "description"});
  await settle();
  assert.equal(f.requests[1].url, "/youtubei/v1/get_transcript");
  assert.equal(f.sent.at(-1).transcript.segments.length, 2);
});

test("the page bridge rejects unverified or mismatched caption language choices", async () => {
  for (const modern of [true, false]) {
    const f = pageFixture({modern});
    f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, captionLanguage: "fr:manual", requestId: "language"});
    await settle();
    assert.equal(f.sent.at(-1).transcript, null);
    assert.equal(f.timers.size, 0);
  }
  const f = pageFixture();
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, captionLanguage: "en:manual", requestId: "verified"});
  await settle();
  assert.equal(f.sent.at(-1).transcript.languageCode, "en");
});

test("navigation while the page request is in flight discards its captions", async () => {
  const f = pageFixture({modern: true});
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "navigate"});
  f.context.location.href = videoUrl(VIDEO_B);
  await settle();
  assert.equal(f.sent.at(-1).transcript, null);
  assert.equal(f.timers.size, 0);
});

test("a timed-out modern request can still fall back to the legacy endpoint", async () => {
  const f = pageFixture({pending: true});
  const original = f.context.fetch;
  f.context.fetch = (url, options) => url.endsWith("get_panel") ? original(url, options)
    : Promise.resolve({ok: true, json: async () => ({transcriptSegmentRenderer: {startMs: "0", snippet: {simpleText: "Legacy fallback."}}})});
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "timeout"});
  await settle();
  for (const [callback, ms] of [...f.timers]) if (ms === 2800) callback();
  await settle();
  assert.equal(f.sent.at(-1).transcript.segments[0].text, "Legacy fallback.");
  assert.equal(f.timers.size, 0);
});

test("signed-in request authentication stays inside the page bridge", async () => {
  const f = pageFixture({modern: true});
  f.context.document.cookie = "SAPISID=test-session-cookie";
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "signed-in"});
  await settle();
  assert.match(f.requests[0].options.headers.Authorization, /^SAPISIDHASH \d+_[a-f0-9]{40}$/);
  assert.equal(f.requests[0].options.headers["X-Goog-AuthUser"], "0");
  assert.doesNotMatch(JSON.stringify(f.sent), /test-session-cookie|SAPISIDHASH/);
});

test("a rejected page endpoint returns no transcript so the content script can use the panel", async () => {
  const f = pageFixture({blocked: true});
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "blocked"});
  await settle();
  assert.equal(f.sent.at(-1).transcript, null);
  assert.equal(f.timers.size, 0);
});

test("cancellation aborts the page request and releases its timer", async () => {
  const f = pageFixture({pending: true});
  f.deliver({type: "REQUEST_TRANSCRIPT", expectedVideoId: VIDEO_A, requestId: "cancel"});
  await settle();
  f.deliver({type: "CANCEL_TRANSCRIPT_REQUEST", requestId: "cancel"});
  await settle();
  assert.equal(f.requests[0].options.signal.aborted, true);
  assert.equal(f.sent.at(-1).transcript, null);
  assert.equal(f.timers.size, 0);
});

function contentFixture({cancel = false, mismatched = false, noResponse = false} = {}) {
  const listeners = new Set(), sent = [], timers = new Map();
  const controller = new AbortController();
  const transcript = {source: "youtube_transcript_api", language: "English", languageCode: "en", isGenerated: false,
    segments: [{startSeconds: 1, durationSeconds: 4, text: "Source caption."}]};
  const window = {
    addEventListener(type, callback) { if (type === "message") listeners.add(callback); },
    removeEventListener(type, callback) { if (type === "message") listeners.delete(callback); },
    postMessage(message) {
      sent.push(message);
      if (!["REQUEST_TRANSCRIPT", "REQUEST_TRANSCRIPT_BY_ID"].includes(message.type)) return;
      if (cancel) { controller.abort(); return; }
      if (noResponse) return;
      const data = {source: "video-preview-page-context", type: "TRANSCRIPT_RESULT", requestId: message.requestId,
        videoId: mismatched ? VIDEO_B : VIDEO_A, transcript};
      for (const callback of [...listeners]) callback({source: window, data});
    }
  };
  const context = scriptContext("content-script.js", {window, controller, location: {href: videoUrl(VIDEO_A)},
    document: {querySelector: () => null, querySelectorAll: () => []},
    setTimeout(fn, ms) { timers.set(fn, ms); return fn; }, clearTimeout(fn) { timers.delete(fn); }});
  run(context, `latestContext = {videoId:'${VIDEO_A}',hasTranscriptEndpoint:false,canFetchTranscript:true,captionTracks:[]}; sleep = async () => {}`);
  return {context, controller, sent, timers, listeners,
    extract: () => run(context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'}, controller.signal)`)};
}

test("the content script uses page transcripts without opening the description or panel", async () => {
  const f = contentFixture();
  const result = await f.extract();
  assert.equal(result.source, "youtube_transcript_api");
  assert.equal(result.segments[0].text, "Source caption.");
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 1); // Only the existing video-context listener remains.
});

test("content cancellation and timeouts clean up the bridge and cancel the page request", async () => {
  for (const cancel of [true, false]) {
    const f = contentFixture({cancel, noResponse: true});
    const result = run(f.context, `fetchPageTranscript('${VIDEO_A}',controller.signal)`);
    if (cancel) await assert.rejects(result, {name: "AbortError"});
    else { for (const callback of f.timers.keys()) callback(); assert.equal(await result, null); }
    assert.equal(f.sent.at(-1).type, "CANCEL_TRANSCRIPT_REQUEST");
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 1);
  }
});

test("results for another video are ignored until the bridge times out", async () => {
  const f = contentFixture({mismatched: true});
  const result = run(f.context, `fetchPageTranscript('${VIDEO_A}',controller.signal)`);
  assert.equal(f.timers.size, 1);
  for (const callback of f.timers.keys()) callback();
  assert.equal(await result, null);
});

test("extraction waits for matching player data after navigation before selecting captions", async () => {
  const f = contentFixture();
  let polls = 0, now = 0;
  f.context.Date = {now: () => now};
  f.context.pause = async ms => {
    now += ms;
    if (++polls === 3) run(f.context, `latestContext = {videoId:'${VIDEO_A}',playerReady:true,canFetchTranscript:true,captionTracks:[]}`);
  };
  run(f.context, `latestContext = {videoId:'${VIDEO_B}',playerReady:false,captionTracks:[]}; sleep = pause`);
  const result = await f.extract();
  assert.equal(polls, 3);
  assert.equal(result.source, "youtube_transcript_api");
  assert.equal(f.sent.filter(message => message.type === "REQUEST_TRANSCRIPT").length, 1);
});

test("explicit caption choice is sent to the page and independently verified by the content script", async () => {
  const f = contentFixture();
  const result = await run(f.context, `fetchPageTranscript('${VIDEO_A}',controller.signal,'fr:manual')`);
  assert.equal(result, null);
  assert.equal(f.sent.find(message => message.type === "REQUEST_TRANSCRIPT").captionLanguage, "fr:manual");
  assert.equal(f.timers.size, 0);
});

for (const url of [videoUrl(VIDEO_A), "https://www.youtube.com/", videoUrl(VIDEO_B)]) {
test(`both script worlds extract the requested video without a player/button from ${url}`, async () => {
  const page = pageFixture({modern: true, url});
  page.window.ytInitialData = null;
  page.window.ytInitialPlayerResponse.captions = null;
  const listeners = new Set();
  const window = {
    addEventListener(type, callback) { if (type === "message") listeners.add(callback); },
    removeEventListener(type, callback) { if (type === "message") listeners.delete(callback); },
    postMessage(message) { page.deliver(message); }
  };
  page.window.postMessage = data => {
    page.sent.push(data);
    for (const callback of [...listeners]) callback({source: window, data});
  };
  const controller = new AbortController();
  const chrome = {runtime: {id: "test", onMessage: event(), sendMessage: async () => ({ok: true})}};
  const context = scriptContext("content-script.js", {window, controller, chrome, location: {href: url},
    document: {querySelector: () => null, querySelectorAll: () => []},
    fetch: () => { throw new Error("No timedtext requests should be needed"); }
  });
  run(context, "sleep = async () => {}");
  let transcript;
  if (url === videoUrl(VIDEO_A)) transcript = await run(context, `extractTranscriptFromPage({expectedVideoId:'${VIDEO_A}'},controller.signal)`);
  else {
    const response = await new Promise(resolve => chrome.runtime.onMessage.listeners[0]({
      type: "EXTRACT_TRANSCRIPT_BY_ID", expectedVideoId: VIDEO_A, jobId: "thumbnail"
    }, {}, resolve));
    assert.ok(response.ok, response.error);
    transcript = response.transcript;
    await settle();
    assert.equal(run(context, "thumbnailTranscriptControllers.size"), 0);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(transcript.segments)), [
    {startSeconds: 1, durationSeconds: 4, text: "First caption."},
    {startSeconds: 5, durationSeconds: 0, text: "Second caption."}
  ]);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, "/youtubei/v1/get_panel");
  assert.equal(page.timers.size, 0);
  assert.equal(listeners.size, 1);
});
}

test("thumbnail cancellation is isolated by job and leaves player extraction alone", async () => {
  const controller = new AbortController();
  const first = new AbortController(), second = new AbortController();
  // The real runtime handler responds without aborting either unrelated controller.
  const chrome = {runtime: {id: "test", onMessage: event()}};
  const context = scriptContext("content-script.js", {chrome, window: {addEventListener() {}, postMessage() {}},
    first, second, controller, location: {href: "https://www.youtube.com/"}});
  run(context, `activeTranscriptController = controller; thumbnailTranscriptControllers.set('first',first); thumbnailTranscriptControllers.set('second',second)`);
  const response = await new Promise(resolve => chrome.runtime.onMessage.listeners[0]({type: "CANCEL_TRANSCRIPT_BY_ID", jobId: "first"}, {}, resolve));
  assert.ok(response.ok);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(controller.signal.aborted, false);
});

test("extraction before the player loads reads captions by ID, otherwise reports the player as loading", async () => {
  const f = contentFixture();
  run(f.context, `latestContext = {videoId:'${VIDEO_A}',playerReady:false,captionTracks:[]}`);
  const result = await f.extract();
  assert.equal(result.segments[0].text, "Source caption.");
  assert.equal(f.sent.find(message => message.type === "REQUEST_TRANSCRIPT_BY_ID").expectedVideoId, VIDEO_A);

  const empty = contentFixture({noResponse: true});
  run(empty.context, `latestContext = {videoId:'${VIDEO_A}',playerReady:false,captionTracks:[]}`);
  const pending = empty.extract();
  await settle();
  for (const callback of empty.timers.keys()) callback();
  await assert.rejects(pending, {code: "PLAYER_LOADING"});
});
