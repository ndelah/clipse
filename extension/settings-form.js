import {OUTPUT_LANGUAGES, fillCaptionOptions} from "./languages.js";
import {loadSettings, DEFAULT_SETTINGS, summaryConfiguration} from "./shared.js";
import {loadCategoryEditor, readCategoryEditor, wireCategoryEditor} from "./category-editor.js";

function showKeyState(elements, saved = false) {
  const hasKey = Boolean(elements.apiKey.value.trim());
  elements.connectionState.textContent = hasKey ? (saved ? "Key saved" : "Key entered") : "Not set up";
  elements.connectionState.classList.toggle("has-key", hasKey);
}

function concealKeys(elements) {
  for (const [input, button, label] of [[elements.apiKey, elements.toggleKeyButton, "API key"]]) {
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
  for (const key of ["model", "summaryLength"]) elements[key].value = config[key];
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
  concealKeys(elements);
  showKeyState(elements, true);
  elements.settingsStatus.textContent = "Your preferences, saved in this browser.";
  elements.settingsStatus.classList.toggle("error", false);
  loadCategoryEditor(elements, config.categories);
}

export function settingsFromForm(elements) {
  return {apiKey: elements.apiKey.value.trim(), ...summaryConfiguration({
    model: elements.model.value, outputLanguage: /^(same|same as captions)$/i.test(elements.outputLanguage.value.trim()) ? "same" : elements.outputLanguage.value, captionLanguage: elements.captionLanguage.value, summaryLength: elements.summaryLength.value,
    categories: readCategoryEditor(elements)
  })};
}

export function wireSettingsForm(elements, {onSaved = () => {}} = {}) {
  wireCategoryEditor(elements);
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
  elements.removeKeyButton.addEventListener("click", () => {
    elements.apiKey.value = "";
    concealKeys(elements);
    showKeyState(elements);
    markUnsaved();
  });
  for (const [input, button, label] of [[elements.apiKey, elements.toggleKeyButton, "API key"]]) {
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
      onSaved(settings);
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  });
  elements.validateKeyButton.addEventListener("click", async () => {
    busy(true, "test");
    status("Checking summaries and video classification…");
    try {
      const response = await chrome.runtime.sendMessage({type: "VALIDATE_SETTINGS", settings: {apiKey: elements.apiKey.value.trim(), model: elements.model.value.trim() || DEFAULT_SETTINGS.model}});
      if (!response?.ok) throw new Error(response?.error || "Could not check access. Try again.");
      status(response.message);
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  });
}

