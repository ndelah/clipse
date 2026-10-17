import vm from "node:vm";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";
import * as shared from "../extension/shared.js";
import * as categories from "../extension/categories.js";
import * as evidence from "../extension/evidence.js";
import * as languages from "../extension/languages.js";
import * as recovery from "../extension/recovery.js";
import * as routing from "../extension/routing.js";

export const VIDEO_A = "abcdefghijk";
export const VIDEO_B = "lmnopqrstuv";
export function summary(videoId = VIDEO_A, extra = {}) {
  return {videoId, url: shared.videoUrl(videoId), title: `Video ${videoId}`, channel: "Test channel", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    preview: {one_sentence_summary: "An overview", full_summary: "A complete summary.", learning_outcomes: ["An outcome"], key_takeaways: [{text: "Useful point", timestamp_seconds: 42}]}, ...extra};
}
export function event() {
  const listeners = [];
  return {listeners, addListener(listener) { listeners.push(listener); }, removeListener(listener) { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); }};
}
export function storage(seed = {}) {
  const state = structuredClone(seed);
  return {state, async get(defaults = {}) { return structuredClone({...defaults, ...state}); }, async set(patch) { Object.assign(state, structuredClone(patch)); }, async setAccessLevel() {}};
}
export function scriptContext(filename, globals = {}) {
  const context = vm.createContext({URL, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal, DOMException, crypto: webcrypto, structuredClone, ...categories, ...routing, ...shared, ...evidence, ...languages, ...recovery, ...globals});
  const source = readFileSync(new URL(`../extension/${filename}`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(source, context, {filename});
  return context;
}
export const run = (context, code) => vm.runInContext(code, context);

export class Element {
  constructor(tagName = "div") {
    this.tagName = tagName; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.value = ""; this.textContent = ""; this.style = {};
    const classes = new Set();
    this.classList = {toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); }};
  }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  async fire(name) { for (const listener of this.listeners[name] || []) await listener({currentTarget: this}); }
  async click() { await this.fire("click"); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...elements) { this.children.push(...elements); }
  appendChild(element) { this.append(element); }
  replaceChildren(...elements) { this.children = [...elements]; }
  querySelector(selector) { if (selector === "summary") return this.summary ||= new Element("summary"); return null; }
  matches() { return false; }
  focus() {}
  remove() {}
}
export async function settle() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }
