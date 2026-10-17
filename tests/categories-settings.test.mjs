import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Element, storage, scriptContext, run} from "./helpers.mjs";
import {DEFAULT_CATEGORIES, LEGACY_CATEGORIES} from "../extension/categories.js";

async function form(seed = {}, sendMessage = async () => ({ok: true, message: "Key and model access verified."})) {
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const local = storage(seed);
  const context = scriptContext("category-editor.js", {document: {createElement: tag => new Element(tag)}, chrome: {storage: {local}, runtime: {sendMessage}}});
  const source = readFileSync(new URL("../extension/settings-form.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  run(context, source);
  context.elements = elements;
  run(context, "wireSettingsForm(elements)");
  await run(context, "loadSettingsForm(elements)");
  return {context, elements, local};
}

test("categories can be added, edited, removed and saved from the actual settings form", async () => {
  const f = await form({apiKey: "existing-key"});
  assert.equal(f.elements.categoryList.children.length, DEFAULT_CATEGORIES.length);
  const recipe = f.elements.categoryList.children[0];
  const instruction = recipe.children[3].children[0];
  instruction.value = "Retain each setup command."; await instruction.fire("input");
  await f.elements.addCategoryButton.click();
  const custom = f.elements.categoryList.children.at(-2);
  for (const [i, value] of [[1, "Recipes"], [2, "Cooking demonstrations"], [3, "Preserve quantities and temperatures."]]) {
    const input = custom.children[i].children[0]; input.value = value; await input.fire("input");
  }
  await f.elements.categoryList.children[1].children.at(-1).click(); // Remove DIY, crafts, and repairs.
  await f.elements.saveSettingsButton.click();
  assert.equal(f.local.state.categories.length, DEFAULT_CATEGORIES.length);
  assert.equal(f.local.state.categories[0].instructions, "Retain each setup command.");
  assert.ok(f.local.state.categories.some(category => category.name === "Recipes"));
  assert.ok(!f.local.state.categories.some(category => category.id === "diy_repairs"));
  assert.ok(f.local.state.categories.some(category => category.id === "other"));
  assert.equal(f.elements.categoryList.children.at(-1).children.at(-1).tagName, "p");
  await run(f.context, "loadSettingsForm(elements)");
  assert.equal(f.elements.categoryList.children[0].children[3].children[0].value, "Retain each setup command.");
});

test("invalid category drafts cannot silently discard edits", async () => {
  const f = await form({apiKey: "existing-key"});
  await f.elements.addCategoryButton.click();
  await f.elements.saveSettingsButton.click();
  assert.equal(f.local.state.categories, undefined);
  assert.match(f.elements.settingsStatus.textContent, /Every category/);
  await f.elements.categoryList.children.at(-2).children.at(-1).click();
  await f.elements.saveSettingsButton.click();
  assert.ok(f.local.state.categories);
  assert.equal(f.elements.classifierProvider, undefined);
  assert.equal(f.elements.jevApiKey, undefined);
});

test("settings show unsaved edits and conceal the key after saving or reopening", async () => {
  const f = await form({apiKey: "existing-key", jevApiKey: "typesafe-key", classifierProvider: "jev"});
  assert.equal(f.elements.connectionState.textContent, "Key saved");
  for (const [input, button] of [[f.elements.apiKey, f.elements.toggleKeyButton]]) {
    assert.equal(input.type, "password");
    await button.click();
    assert.equal(input.type, "text");
    assert.equal(button.getAttribute("aria-pressed"), "true");
  }
  f.elements.outputLanguage.value = "French";
  await f.elements.settingsForm.fire("input");
  assert.match(f.elements.settingsStatus.textContent, /unsaved/);
  await f.elements.saveSettingsButton.click();
  assert.equal(f.local.state.outputLanguage, "French");
  for (const [input, button] of [[f.elements.apiKey, f.elements.toggleKeyButton]]) {
    assert.equal(input.type, "password");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    await button.click();
  }
  await run(f.context, "loadSettingsForm(elements)");
  assert.equal(f.elements.apiKey.type, "password");
  assert.equal("jevApiKey" in f.local.state, false);
});

test("failed connection checks preserve saved settings and release the busy controls", async () => {
  let finish;
  const f = await form({apiKey: "saved-key"}, () => new Promise(resolve => { finish = resolve; }));
  f.elements.apiKey.value = "new-key";
  await f.elements.apiKey.fire("input");
  assert.equal(f.elements.connectionState.textContent, "Key entered");
  const saving = f.elements.saveSettingsButton.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.elements.settingsForm.getAttribute("inert"), "");
  assert.equal(f.elements.saveSettingsButton.textContent, "Saving…");
  assert.equal(f.elements.validateKeyButton.disabled, true);
  finish({ok: false, error: "Model access unavailable."});
  await saving;
  assert.equal(f.local.state.apiKey, "saved-key");
  assert.equal(f.elements.settingsStatus.textContent, "Model access unavailable.");
  assert.equal(f.elements.settingsForm.getAttribute("inert"), null);
  assert.equal(f.elements.settingsForm.getAttribute("aria-busy"), "false");
  assert.equal(f.elements.saveSettingsButton.disabled, false);
  assert.equal(f.elements.validateKeyButton.disabled, false);
});


test("settings display upgraded defaults and preserve an edited recipe category after saving", async () => {
  const f = await form({apiKey: "existing-key", categories: LEGACY_CATEGORIES});
  assert.equal(f.elements.categoryList.children.length, 21);
  assert.equal(f.elements.categoryList.children[0].children[0].textContent, "Recipes and cooking");
  const instructions = f.elements.categoryList.children[0].children[3].children[0];
  assert.match(instructions.value, /cooking times/);
  instructions.value = "Keep every ingredient quantity and cooking time.";
  await instructions.fire("input");
  await f.elements.saveSettingsButton.click();
  await run(f.context, "loadSettingsForm(elements)");
  assert.equal(f.elements.categoryList.children[0].children[3].children[0].value, instructions.value);
});


test("removing a key requires saving, retains preferences, and makes no paid connection check", async () => {
  let checks = 0;
  const f = await form({apiKey: "existing-key", summaryLength: "brief"}, async () => { checks++; return {ok: true}; });
  await f.elements.removeKeyButton.click();
  assert.equal(f.local.state.apiKey, "existing-key");
  assert.equal(f.elements.apiKey.value, "");
  await f.elements.saveSettingsButton.click();
  assert.equal(f.local.state.apiKey, "");
  assert.equal(f.local.state.summaryLength, "brief");
  assert.equal(checks, 0);
});
