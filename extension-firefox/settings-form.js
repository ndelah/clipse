import {OUTPUT_LANGUAGES, fillCaptionOptions} from "./languages.js";
import {loadSettings, DEFAULT_SETTINGS, summaryConfiguration, exportTargets} from "./shared.js";
import {obsidianFolder} from "./obsidian.js";
import {notionPageId, checkNotion, requestNotionAccess} from "./notion.js";
import {loadCategoryEditor, readCategoryEditor, wireCategoryEditor} from "./category-editor.js";

function showKeyState(elements, saved = false) {
  const hasKey = Boolean(elements.apiKey.value.trim());
  elements.connectionState.textContent = hasKey ? (saved ? "Key saved" : "Key entered") : "Not set up";
  elements.connectionState.classList.toggle("has-key", hasKey);
}

const SECRETS = elements => [[elements.apiKey, elements.toggleKeyButton, "API key"], [elements.jevApiKey, elements.toggleJevKeyButton, "TypeSafe API key"],
  [elements.notionToken, elements.toggleNotionKeyButton, "Notion integration secret"]];
const TARGET_INPUTS = {copy: "exportCopy", download: "exportDownload", obsidian: "exportObsidian", notion: "exportNotion"};
function chosenTargets(elements) { return exportTargets(Object.entries(TARGET_INPUTS).filter(([, id]) => elements[id].checked).map(([target]) => target)); }
// A destination's setup only appears once it is chosen, and opens when it still needs filling in.
function showTargetSetup(elements) {
  const targets = chosenTargets(elements);
  elements.obsidianSettings.classList.toggle("hidden", !targets.includes("obsidian"));
  elements.notionSettings.classList.toggle("hidden", !targets.includes("notion"));
  if (targets.includes("notion") && !(elements.notionToken.value.trim() && notionPageId(elements.notionParent.value))) elements.notionSettings.open = true;
}

function concealKeys(elements) {
  for (const [input, button, label] of SECRETS(elements)) {
    input.type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-label", `Show ${label}`);
    button.setAttribute("aria-pressed", "false");
  }
}

export async function loadSettingsForm(elements) {
  const settings = await loadSettings(chrome.storage.local);
  elements.apiKey.value = settings.apiKey || "";
  const config = summaryConfiguration(settings);
  for (const key of ["model", "summaryLength", "classifierProvider"]) elements[key].value = config[key];
  elements.outputLanguage.value = config.outputLanguage === "same" ? "Same as captions" : config.outputLanguage;
  elements.outputLanguages.replaceChildren();
  for (const name of ["Same as captions", ...OUTPUT_LANGUAGES]) {
    const option = document.createElement("option"); option.value = name; elements.outputLanguages.appendChild(option);
  }
  let tracks = [];
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const response = await chrome.tabs.sendMessage(tab.id, {type: "GET_VIDEO_CONTEXT"});
    tracks = response?.context?.captionTracks || [];
  } catch { /* Settings also work without a YouTube tab. */ }
  fillCaptionOptions(elements.captionLanguage, tracks, config.captionLanguage, document);
  elements.jevApiKey.value = settings.jevApiKey || "";
  elements.obsidianVault.value = settings.obsidianVault || "";
  elements.obsidianFolder.value = settings.obsidianFolder ?? DEFAULT_SETTINGS.obsidianFolder;
  elements.notionToken.value = settings.notionToken || "";
  elements.notionParent.value = settings.notionParent || "";
  const targets = exportTargets(settings.exportTargets);
  for (const [target, id] of Object.entries(TARGET_INPUTS)) elements[id].checked = targets.includes(target);
  showTargetSetup(elements);
  elements.jevSettings.classList.toggle("hidden", config.classifierProvider !== "jev");
  if (config.classifierProvider === "jev") elements.classificationSettings.open = true;
  concealKeys(elements);
  showKeyState(elements, true);
  elements.settingsStatus.textContent = "Your preferences, saved in this browser.";
  elements.settingsStatus.classList.toggle("error", false);
  loadCategoryEditor(elements, config.categories);
}

export function settingsFromForm(elements) {
  if (elements.classifierProvider.value === "jev" && !elements.jevApiKey.value.trim()) throw new Error("Add a TypeSafe API key to classify videos with Jev.");
  const targets = chosenTargets(elements);
  const notionParent = elements.notionParent.value.trim();
  return {apiKey: elements.apiKey.value.trim(), jevApiKey: elements.jevApiKey.value.trim(), exportTargets: targets,
    notionToken: elements.notionToken.value.trim(), notionParent: notionParent.slice(0, 500),
    obsidianVault: elements.obsidianVault.value.trim().slice(0, 200), obsidianFolder: obsidianFolder(elements.obsidianFolder.value).slice(0, 200), ...summaryConfiguration({
    model: elements.model.value, outputLanguage: /^(same|same as captions)$/i.test(elements.outputLanguage.value.trim()) ? "same" : elements.outputLanguage.value, captionLanguage: elements.captionLanguage.value, summaryLength: elements.summaryLength.value,
    classifierProvider: elements.classifierProvider.value, categories: readCategoryEditor(elements)
  })};
}

export function wireSettingsForm(elements, {onSaved = () => {}} = {}) {
  wireCategoryEditor(elements);
  elements.classifierProvider.addEventListener("change", () => elements.jevSettings.classList.toggle("hidden", elements.classifierProvider.value !== "jev"));
  const status = (message, error = false) => {
    elements.settingsStatus.textContent = message;
    elements.settingsStatus.classList.toggle("error", error);
  };
  const markUnsaved = () => status("You have unsaved changes.");
  elements.settingsForm.addEventListener("input", markUnsaved);
  elements.settingsForm.addEventListener("change", markUnsaved);
  elements.addCategoryButton.addEventListener("click", markUnsaved);
  elements.categoryList.addEventListener("click", event => {
    if (event.target?.closest("button")) markUnsaved();
  });
  elements.apiKey.addEventListener("input", () => showKeyState(elements));
  for (const id of Object.values(TARGET_INPUTS)) elements[id].addEventListener("change", () => showTargetSetup(elements));
  elements.testNotionButton.addEventListener("click", async () => {
    const access = requestNotionAccess();
    const notionStatus = (message, error = false) => { elements.notionStatus.textContent = message; elements.notionStatus.classList.toggle("error", error); };
    elements.testNotionButton.disabled = true; notionStatus("Checking Notion…");
    try {
      if (!await access) throw new Error("Clipse needs permission to reach api.notion.com to save pages. Test again and choose Allow.");
      notionStatus(await checkNotion({token: elements.notionToken.value, parent: elements.notionParent.value}));
    } catch (error) { notionStatus(error.message, true); }
    finally { elements.testNotionButton.disabled = false; }
  });
  for (const [input, button, label] of SECRETS(elements)) {
    button.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
      button.setAttribute("aria-label", `${showing ? "Show" : "Hide"} ${label}`);
      button.setAttribute("aria-pressed", String(!showing));
    });
  }
  const busy = (active, action) => {
    elements.saveSettingsButton.disabled = active;
    elements.validateKeyButton.disabled = active;
    if (active) elements.settingsForm.setAttribute("inert", "");
    else elements.settingsForm.removeAttribute("inert");
    elements.saveSettingsButton.textContent = active && action === "save" ? "Saving…" : "Save settings";
    elements.validateKeyButton.textContent = active && action === "test" ? "Checking…" : "Test connection";
    elements.settingsForm.setAttribute("aria-busy", String(active));
  };
  elements.saveSettingsButton.addEventListener("click", async () => {
    // Ask for Notion access while the click still counts as a gesture; saving doesn't depend on the answer.
    const access = elements.exportNotion.checked ? requestNotionAccess().catch(() => false) : null;
    try {
      const settings = settingsFromForm(elements);
      busy(true, "save");
      const previous = await loadSettings(chrome.storage.local);
      if (settings.apiKey && (previous.apiKey !== settings.apiKey || previous.model !== settings.model)) {
        status("Checking connection before saving…");
        const response = await chrome.runtime.sendMessage({type: "VALIDATE_SETTINGS", settings});
        if (!response?.ok) throw new Error(response?.error || "Could not verify the connection. Your settings were not changed.");
      }
      await chrome.storage.local.set(settings);
      concealKeys(elements);
      showKeyState(elements, true);
      status(settings.apiKey ? "Saved. You're ready to summarize a video." : "Saved. Add an API key before creating a summary.");
      // An unfinished Notion setup never blocks saving everything else.
      if (settings.exportTargets.includes("notion") && !(settings.notionToken && notionPageId(settings.notionParent))) {
        elements.notionSettings.open = true;
        status("Saved. Notion isn’t connected yet: add the integration secret and page link under Notion.");
      } else if (access && !await access) status("Saved. Chrome didn’t allow access to Notion yet; it will ask again when you save to Notion.");
      onSaved(settings);
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  });
  elements.validateKeyButton.addEventListener("click", async () => {
    busy(true, "test");
    status("Checking key and model access (no summary request)…");
    try {
      const response = await chrome.runtime.sendMessage({type: "VALIDATE_SETTINGS", settings: {apiKey: elements.apiKey.value.trim(), model: elements.model.value.trim() || DEFAULT_SETTINGS.model}});
      if (!response?.ok) throw new Error(response?.error || "Could not check access. Try again.");
      status(`${response.message}${elements.classifierProvider.value === "jev" ? " TypeSafe access is checked during classification." : ""}`);
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  });
}
