import test from "node:test";
import assert from "node:assert/strict";
import {Element, scriptContext, settle, VIDEO_A, VIDEO_B} from "./helpers.mjs";

function fixture({modern = false, videoId = VIDEO_A} = {}) {
  class Node extends Element {
    constructor(tag) {
      super(tag); this.dataset = {}; this.parentElement = null;
      this.classList.add = name => this.classList.toggle(name, true);
      this.classList.remove = name => this.classList.toggle(name, false);
    }
    get isConnected() { return this.connected || Boolean(this.parentElement?.isConnected); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    getBoundingClientRect() { return this.rect || {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
      this.parentElement = null;
    }
    async click(trusted = true) {
      const event = {isTrusted: trusted, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
      for (const listener of this.listeners.click || []) await listener(event);
      return event;
    }
  }
  const card = new Node("card"); card.connected = true;
  const thumbnail = new Node("thumbnail");
  const link = new Node("a"); link.href = `https://www.youtube.com/watch?v=${videoId}`;
  const title = {textContent: " Video from the feed "};
  if (modern) { card.append(link); link.append(thumbnail); } else { card.append(thumbnail); thumbnail.append(link); }
  thumbnail.closest = () => modern ? link : null;
  card.querySelectorAll = () => [link];
  card.querySelector = selector => selector.startsWith("ytd-thumbnail") ? thumbnail : selector.startsWith("#video-title") ? title : null;
  const events = {}, messages = [], timers = new Map(), observers = []; let timerId = 0, live = true;
  const preview = new Node("ytd-video-preview"); preview.connected = true;
  const document = {querySelector: selector => selector === "ytd-video-preview" ? preview : null,
    querySelectorAll: () => card.connected ? [card] : [], createElement: tag => new Node(tag), addEventListener(name, fn) { events[name] = fn; }};
  const observer = target => observers.find(entry => entry.target === target);
  let response = {ok: true}, status = "ready", pendingStart;
  scriptContext("thumbnail-button.js", {
    location: {href: "https://www.youtube.com/"},
    document,
    chrome: {runtime: {getURL: path => `chrome-extension://test/${path}`}},
    runtimeIsAvailable: () => live,
    async safelySendRuntimeMessage(message) {
      messages.push(message);
      return message.type === "GET_THUMBNAIL_STATUS" ? {ok: true, status, stage: "Reading captions"} : pendingStart ? await pendingStart : response;
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; } disconnect() { this.target = null; }
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); }
  });
  const host = modern ? card : thumbnail;
  return {card, host, preview, messages, timers,
    button: () => host.children.find(node => node.className === "clipse-thumbnail-button"),
    navigate() { events["yt-navigate-finish"](); },
    recycle(id) { link.href = `https://www.youtube.com/watch?v=${id}`; observer(document).callback(); },
    showPreview(rect) { preview.rect = rect; observer(preview).callback(); },
    async tick() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await settle(); },
    setStatus(value) { status = value; }, setResponse(value) { response = value; },
    holdStart(promise) { pendingStart = promise; },
    invalidate() { live = false; events["yt-navigate-finish"](); }
  };
}

test("legacy and modern thumbnail actions mount once outside the video link", () => {
  for (const modern of [false, true]) {
    const f = fixture({modern});
    const button = f.button();
    assert.ok(button);
    assert.equal(button.parentElement, f.host);
    assert.equal(button.children[0].src, "chrome-extension://test/assets/eclipse.svg");
    assert.equal(button.getAttribute("aria-label"), "Summarize video with Clipse");
    f.navigate();
    assert.equal(f.button(), button);
    assert.equal(f.messages.length, 0, "Do not poll every card on the feed at startup");
  }
  assert.equal(fixture({videoId: "invalid"}).button(), undefined);
});

test("thumbnail click prevents navigation, targets its video, and tracks progress", async () => {
  const f = fixture(); f.setStatus("running");
  const event = await f.button().click();
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(f.messages[0].type, "START_THUMBNAIL_JOB");
  assert.equal(f.messages[0].videoId, VIDEO_A);
  assert.equal(f.messages[0].title, "Video from the feed");
  assert.equal(f.button().disabled, true);
  assert.equal(f.button().getAttribute("aria-busy"), "true");
  f.setStatus("completed"); await f.tick();
  assert.equal(f.button().disabled, false);
  assert.match(f.button().title, /saved in history/);
});

test("synthetic clicks cannot start jobs and setup failures allow retry", async () => {
  const f = fixture();
  await f.button().click(false);
  assert.equal(f.messages.length, 0);
  f.setResponse({ok: false, error: "Add your OpenAI API key in Settings"});
  await f.button().click();
  assert.equal(f.button().disabled, false);
  assert.equal(f.button().children[1].textContent, "Retry summary");
  assert.match(f.button().title, /API key/);
  f.setResponse({ok: true}); await f.button().click();
  assert.equal(f.messages.filter(message => message.type === "START_THUMBNAIL_JOB").length, 2);
});

test("recycled cards use their new video and ignore stale in-flight responses", async () => {
  const f = fixture();
  let finish;
  f.holdStart(new Promise(resolve => { finish = resolve; }));
  const oldButton = f.button(), pending = oldButton.click();
  f.recycle(VIDEO_B);
  await f.tick();
  assert.notEqual(f.button(), oldButton);
  assert.equal(oldButton.parentElement, null);
  finish({ok: false, error: "Old video failed"}); await pending;
  assert.equal(f.button().dataset.state, "ready");
  await f.button().click();
  assert.equal(f.messages.filter(message => message.type === "START_THUMBNAIL_JOB").at(-1).videoId, VIDEO_B);
});

test("removed cards and invalidated extension contexts clean up buttons and polling", async () => {
  const removed = fixture();
  removed.setStatus("running"); await removed.button().click();
  const button = removed.button();
  removed.card.connected = false; removed.navigate();
  assert.equal(button.parentElement, null);
  assert.equal(removed.timers.size, 0);
  const invalid = fixture(); const old = invalid.button();
  invalid.invalidate();
  assert.equal(old.parentElement, null);
  assert.equal(invalid.host.classList.contains("clipse-thumbnail-host"), false);
});

test("the thumbnail action stays on top of YouTube's hover preview", () => {
  const f = fixture(), button = f.button();
  f.host.rect = {left: 100, top: 200, right: 400, bottom: 370, width: 300, height: 170};
  f.showPreview({left: 96, top: 196, right: 404, bottom: 374, width: 308, height: 178});
  assert.equal(button.parentElement, f.preview);
  assert.equal(button.classList.contains("clipse-thumbnail-preview"), true);
  assert.deepEqual([button.style.top, button.style.left], ["12px", "12px"]);
  f.showPreview({left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0});
  assert.equal(button.parentElement, f.host);
  assert.equal(button.classList.contains("clipse-thumbnail-preview"), false);
  assert.deepEqual([button.style.top, button.style.left], ["", ""]);
  f.showPreview({left: 600, top: 196, right: 900, bottom: 374, width: 300, height: 178});
  assert.equal(button.parentElement, f.host, "A preview over another card leaves this button alone");
});
