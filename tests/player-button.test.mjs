import test from "node:test";
import assert from "node:assert/strict";
import {Element, scriptContext, settle, VIDEO_A, VIDEO_B} from "./helpers.mjs";

function fixture({overlay = false} = {}) {
  class Node extends Element {
    constructor(tag) {
      super(tag); this.dataset = {}; this.parentElement = null;
      this.classList.add = name => this.classList.toggle(name, true);
    }
    prepend(node) {
      node.remove(); node.parentElement = this; this.children.unshift(node);
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
      this.parentElement = null;
    }
    async click(trusted = true) {
      for (const listener of this.listeners.click || []) await listener({isTrusted: trusted, preventDefault() {}, stopPropagation() {}});
    }
  }
  let id = VIDEO_A, status = "ready", response = {ok: true}, live = true, mutations;
  let controls = overlay ? null : new Node("div");
  const player = new Node("div");
  player.querySelector = () => controls;
  const events = {}, messages = [], timers = new Map(); let timerId = 0;
  const document = {querySelector: () => player, createElement: tag => new Node(tag), addEventListener(name, fn) { events[name] = fn; }};
  scriptContext("player-button.js", {document, currentVideoId: () => id, runtimeIsAvailable: () => live,
    chrome: {runtime: {getURL: value => `chrome-extension://test/${value}`}},
    async safelySendRuntimeMessage(message) { messages.push(message); return message.type === "GET_PLAYER_STATUS" ? {ok: true, status, stage: "Writing summary"} : response; },
    MutationObserver: class { constructor(callback) { mutations = callback; } observe() {} disconnect() {} },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(key) { timers.delete(key); }});
  return {player, messages, timers, button: () => (controls || player).children[0],
    navigate(nextId) { id = nextId; events["yt-navigate-finish"](); },
    setStatus(value) { status = value; }, setResponse(value) { response = value; },
    replaceControls() { controls = new Node("div"); mutations(); },
    invalidate() { live = false; events["yt-navigate-finish"](); }};
}

test("the logo mounts in player controls once and survives control replacement", async () => {
  const f = fixture(); await settle();
  const button = f.button();
  assert.equal(button.id, "clipse-summarize-button");
  assert.equal(button.children[0].src, "chrome-extension://test/assets/eclipse.svg");
  f.navigate(VIDEO_A); await settle();
  assert.equal(f.button(), button);
  f.replaceControls();
  for (const callback of [...f.timers.values()]) callback();
  await settle();
  assert.equal(f.button(), button);
  assert.equal(button.parentElement.children.length, 1);
});

test("click starts automatically and running/completed status follows the video", async () => {
  const f = fixture(); await settle();
  f.setStatus("running"); await f.button().click();
  assert.equal(f.messages.find(message => message.type === "START_PLAYER_JOB").videoId, VIDEO_A);
  assert.equal(f.button().dataset.state, "running");
  assert.equal(f.button().getAttribute("aria-busy"), "true");
  f.setStatus("completed");
  for (const callback of [...f.timers.values()]) callback();
  await settle();
  assert.equal(f.button().dataset.state, "completed");
  assert.match(f.button().title, /saved in history/);
  f.navigate(VIDEO_B); await settle();
  await f.button().click();
  assert.equal(f.messages.filter(message => message.type === "START_PLAYER_JOB").at(-1).videoId, VIDEO_B);
});

test("synthetic clicks cannot generate, and errors allow a user retry", async () => {
  const f = fixture(); await settle();
  await f.button().click(false);
  assert.equal(f.messages.some(message => message.type === "START_PLAYER_JOB"), false);
  f.setResponse({ok: false, error: "Add your API key in Settings"});
  await f.button().click();
  assert.equal(f.button().dataset.state, "failed");
  assert.match(f.button().title, /API key/);
  f.setResponse({ok: true}); await f.button().click();
  assert.equal(f.messages.filter(message => message.type === "START_PLAYER_JOB").length, 2);
});

test("clicking a running summary restarts it instead of doing nothing", async () => {
  const f = fixture(); await settle();
  f.setStatus("running"); await f.button().click();
  const first = f.messages.filter(message => message.type === "START_PLAYER_JOB");
  assert.equal(first[0].restart, false);
  assert.match(f.button().title, /Click to restart/);
  await f.button().click();
  const starts = f.messages.filter(message => message.type === "START_PLAYER_JOB");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].restart, true);
});

test("a click while the first start is still pending restarts, and only the latest response labels the button", async () => {
  const f = fixture(); await settle();
  let release;
  f.setResponse(new Promise(resolve => { release = resolve; }));
  const first = f.button().click();
  await settle();
  f.setResponse({ok: false, error: "Second attempt failed"});
  await f.button().click();
  assert.equal(f.messages.filter(message => message.type === "START_PLAYER_JOB").at(-1).restart, true);
  release({ok: true}); await first; await settle();
  assert.match(f.button().title, /Second attempt failed/);
});

test("players without a control row get an overlay and leaving video pages removes it", async () => {
  const f = fixture({overlay: true}); await settle();
  assert.match(f.button().className, /clipse-player-overlay/);
  f.navigate(null); await settle();
  assert.equal(f.player.children.length, 0);
});

test("extension invalidation removes the button", async () => {
  const f = fixture(); await settle();
  const button = f.button();
  f.invalidate();
  assert.equal(button.parentElement, null);
});
