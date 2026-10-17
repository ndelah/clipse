import test from "node:test";
import assert from "node:assert/strict";
import {scriptContext, VIDEO_A, VIDEO_B} from "./helpers.mjs";
import {videoUrl} from "../extension/shared.js";

function fixture({url = videoUrl(VIDEO_B), current = null, initial = null, raw = null} = {}) {
  const sent = [];
  const player = {getPlayerResponse: () => current};
  scriptContext("page-context.js", {
    document: {title: "Current title - YouTube", getElementById: () => player, querySelector: () => null, addEventListener() {}},
    location: {href: url}, setTimeout(fn) { fn(); },
    window: {ytInitialPlayerResponse: initial, ytplayer: {config: {args: {player_response: raw}}}, addEventListener() {}, postMessage(message) { sent.push(message); }}
  });
  return sent[0].payload;
}
const response = (id, title) => ({videoDetails: {videoId: id, title, author: "Channel", lengthSeconds: "120"}});

test("SPA navigation reads the active player instead of stale initial metadata", () => {
  const context = fixture({current: response(VIDEO_B, "New video"), initial: response(VIDEO_A, "Previous video")});
  assert.equal(context.videoId, VIDEO_B);
  assert.equal(context.title, "New video");
});

test("stale metadata is ignored while the next player initializes", () => {
  const context = fixture({current: response(VIDEO_A, "Old"), initial: response(VIDEO_A, "Old"), raw: JSON.stringify(response(VIDEO_A, "Old"))});
  assert.equal(context.videoId, VIDEO_B);
  assert.equal(context.title, "Current title");
  assert.equal(context.captionTracks.length, 0);
  assert.equal(context.playerReady, false);
});

test("matching initial metadata remains available before player initialization", () => {
  const context = fixture({initial: response(VIDEO_B, "Initial video")});
  assert.equal(context.title, "Initial video");
  assert.equal(context.playerReady, true);
});

test("Shorts use the URL identity and non-video pages do not publish a stale video", () => {
  assert.equal(fixture({url: `https://www.youtube.com/shorts/${VIDEO_B}`, initial: response(VIDEO_A, "Old")}).videoId, VIDEO_B);
  assert.equal(fixture({url: "https://www.youtube.com/", initial: response(VIDEO_A, "Old")}).videoId, null);
});
