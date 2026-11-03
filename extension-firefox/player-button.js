// Runs after content-script.js in the isolated extension world.
(() => {
  let button = null;
  let videoId = null;
  let busy = false;
  let startRequest = 0;
  let pollTimer = null;
  let mountTimer = null;

  function label(text, state = "ready") {
    if (!button) return;
    button.title = text;
    button.setAttribute("aria-label", text);
    button.dataset.state = state;
    // Stay clickable while running: a click restarts a job that has stalled.
    button.setAttribute("aria-busy", String(state === "running"));
  }

  async function updateStatus(expectedId = videoId) {
    clearTimeout(pollTimer);
    if (!expectedId || !runtimeIsAvailable()) return;
    const response = await safelySendRuntimeMessage({type: "GET_PLAYER_STATUS", videoId: expectedId});
    if (expectedId !== videoId || !button || busy) return;
    if (!response?.ok) return;
    if (response.status === "running") {
      label(`Clipse: ${response.stage || "Summarizing"}. Click to restart.`, "running");
      pollTimer = setTimeout(() => updateStatus(expectedId), 2000);
    } else if (response.status === "failed") {
      label(`Clipse: ${response.error || "Summary failed"}. Click to retry.`, "failed");
    } else if (response.status === "completed") {
      label("Clipse: summary saved in history. Click to summarize with your current settings.", "completed");
    } else label("Summarize video with Clipse");
  }

  async function summarize(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted || !videoId || !runtimeIsAvailable()) return;
    const expectedId = videoId;
    // Clicking a running job cancels it and starts over instead of doing nothing.
    const restart = busy || button?.dataset.state === "running";
    const request = ++startRequest;
    busy = true;
    clearTimeout(pollTimer);
    label(restart ? "Clipse: restarting summary" : "Clipse: starting summary", "running");
    // Send immediately so the worker can open history within this user gesture.
    const response = await safelySendRuntimeMessage({type: "START_PLAYER_JOB", videoId: expectedId, restart});
    if (expectedId !== videoId || request !== startRequest) return;
    busy = false;
    if (!response?.ok) {
      label(response?.error || "Clipse could not start. Reload this YouTube tab and try again.", "failed");
      return;
    }
    await updateStatus(expectedId);
  }

  function mount() {
    clearTimeout(mountTimer);
    if (!runtimeIsAvailable()) {
      observer.disconnect();
      clearTimeout(pollTimer);
      button?.remove();
      return;
    }
    const nextId = currentVideoId();
    const player = document.querySelector("ytd-reel-video-renderer[is-active] #movie_player, ytd-reel-video-renderer[is-active] #shorts-player")
      || document.querySelector("#movie_player, #shorts-player, #player-container-id");
    const controls = player?.querySelector(".ytp-right-controls");
    const target = controls || player;
    if (!nextId || !/^[\w-]{11}$/.test(nextId) || !target) {
      button?.remove(); button = null; videoId = null; busy = false;
      clearTimeout(pollTimer);
      return;
    }
    if (videoId !== nextId) {
      button?.remove(); button = null; videoId = nextId; busy = false;
      clearTimeout(pollTimer);
    }
    if (button?.parentElement === target) return;
    if (!button) {
      button = document.createElement("button");
      button.id = "clipse-summarize-button";
      button.type = "button";
      const logo = document.createElement("img");
      logo.src = chrome.runtime.getURL("assets/eclipse.svg");
      logo.alt = "";
      logo.draggable = false;
      button.appendChild(logo);
      button.addEventListener("click", summarize);
      label("Summarize video with Clipse");
    }
    button.className = controls ? "ytp-button clipse-player-button" : "clipse-player-button clipse-player-overlay";
    if (!controls) player.classList.add("clipse-player-host");
    target.prepend(button);
    void updateStatus();
  }

  const observer = new MutationObserver(() => {
    if (!mountTimer) mountTimer = setTimeout(() => { mountTimer = null; mount(); }, 100);
  });
  observer.observe(document, {childList: true, subtree: true});
  document.addEventListener("yt-navigate-finish", mount);
  document.addEventListener("yt-player-updated", mount);
  mount();
})();
