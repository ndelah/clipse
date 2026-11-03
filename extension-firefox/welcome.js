import {DEFAULT_SETTINGS, exportTargets} from "./shared.js";

// The practice page: no network. Only the destination choice is saved. Each fake video carries its own summary in data attributes.
const $ = id => document.getElementById(id);
let timer = null;

function openSettings() {
  if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  else location.href = "options.html";
}

function showPanel(state) {
  for (const [id, name] of [["panelIdle", "idle"], ["panelLoading", "loading"], ["panelResult", "result"]]) $(id).classList.toggle("hidden", state !== name);
}

function summarize(video) {
  clearTimeout(timer);
  for (const card of document.querySelectorAll(".demo-video")) card.classList.toggle("selected", card === video);
  showPanel("loading");
  timer = setTimeout(() => {
    const data = video.dataset;
    $("panelTitle").textContent = data.title;
    $("panelMeta").textContent = `${data.channel} · ${data.duration}`;
    $("panelSummary").textContent = data.summary;
    $("panelTakeaways").replaceChildren(...data.takeaways.split(";").map(entry => {
      const [time, text] = entry.split("|");
      const item = document.createElement("li");
      item.append(Object.assign(document.createElement("span"), {className: "panel-time", textContent: time}), text);
      return item;
    }));
    showPanel("result");
  }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900);
}

for (const video of document.querySelectorAll(".demo-video")) {
  const button = video.querySelector(".demo-summarize");
  button.setAttribute("aria-label", `Summarize: ${video.dataset.title}`);
  button.addEventListener("click", () => summarize(video));
}
for (const id of ["openSettingsButton", "openSettingsButtonBottom"]) $(id).addEventListener("click", openSettings);

// Destinations are saved as they're ticked, so there's nothing to submit.
const boxes = [...document.querySelectorAll("input[name=destination]")];
const storage = globalThis.chrome?.storage?.local;
function showNotionSetup() { $("notionSetup").classList.toggle("hidden", !boxes.find(box => box.value === "notion").checked); }
async function loadDestinations() {
  const {exportTargets: saved} = storage ? await storage.get({exportTargets: DEFAULT_SETTINGS.exportTargets}) : {exportTargets: DEFAULT_SETTINGS.exportTargets};
  const targets = exportTargets(saved);
  for (const box of boxes) box.checked = targets.includes(box.value);
  showNotionSetup();
}
for (const box of boxes) box.addEventListener("change", async () => {
  showNotionSetup();
  try {
    await storage?.set({exportTargets: exportTargets(boxes.filter(item => item.checked).map(item => item.value))});
    $("destinationStatus").textContent = "Saved.";
  } catch (error) { $("destinationStatus").textContent = error.message; }
});
loadDestinations().catch(() => {});
