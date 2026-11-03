// Runs in the isolated extension world after content-script.js.
(() => {
  const cards = "ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, .yt-lockup-view-model";
  const entries = new Map();
  let mountTimer = null;

  function videoForCard(card) {
    for (const link of card.querySelectorAll("a[href*='/watch?'], a[href*='/shorts/'], a[href*='/live/']")) {
      try {
        const url = new URL(link.href, location.href);
        if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)) continue;
        const id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
        if (/^[\w-]{11}$/.test(id || "")) return id;
      } catch { /* Ignore non-video links. */ }
    }
    return null;
  }

  function label(entry, text, state = "ready") {
    entry.button.title = text;
    entry.button.setAttribute("aria-label", text);
    entry.button.setAttribute("aria-busy", String(state === "running"));
    entry.button.dataset.state = state;
    entry.button.disabled = state === "running";
    entry.text.textContent = state === "running" ? "Summarizing…" : state === "failed" ? "Retry summary" : "Summarize";
  }

  function current(entry) {
    return entries.get(entry.card) === entry && entry.card.isConnected && videoForCard(entry.card) === entry.videoId;
  }

  async function updateStatus(entry) {
    clearTimeout(entry.pollTimer);
    if (!current(entry) || entry.busy || !runtimeIsAvailable()) return;
    const response = await safelySendRuntimeMessage({type: "GET_THUMBNAIL_STATUS", videoId: entry.videoId});
    if (!current(entry) || entry.busy || !response?.ok) return;
    if (response.status === "running") {
      label(entry, `Clipse: ${response.stage || "Summarizing"}`, "running");
      entry.pollTimer = setTimeout(() => updateStatus(entry), 2000);
    } else if (response.status === "failed") {
      label(entry, `Clipse: ${response.error || "Summary failed"}. Click to retry.`, "failed");
    } else if (response.status === "completed") {
      label(entry, "Clipse: summary saved in history. Click to open history.", "completed");
    } else label(entry, "Summarize video with Clipse");
  }

  async function summarize(entry, event) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted || entry.busy || !current(entry) || !runtimeIsAvailable()) return;
    entry.busy = true;
    label(entry, "Clipse: starting summary", "running");
    const title = entry.card.querySelector("#video-title, .yt-lockup-metadata-view-model__title, [role='heading']")?.textContent?.trim();
    const response = await safelySendRuntimeMessage({type: "START_THUMBNAIL_JOB", videoId: entry.videoId, title});
    if (!current(entry)) return;
    entry.busy = false;
    if (!response?.ok) {
      label(entry, response?.error || "Clipse could not start. Reload YouTube and try again.", "failed");
    } else await updateStatus(entry);
  }

  function remove(entry) {
    clearTimeout(entry.pollTimer);
    entry.button.remove();
    entry.host.classList.remove("clipse-thumbnail-host");
    entries.delete(entry.card);
  }

  function mount() {
    if (!runtimeIsAvailable()) {
      observer.disconnect();
      for (const entry of entries.values()) remove(entry);
      return;
    }
    for (const entry of entries.values()) {
      if (!current(entry) || !entry.button.isConnected) remove(entry);
    }
    for (const card of document.querySelectorAll(cards)) {
      // New layouts may nest a lockup inside a legacy renderer.
      if (entries.has(card) || card.querySelector(cards)) continue;
      const videoId = videoForCard(card);
      const thumbnail = card.querySelector("ytd-thumbnail, yt-thumbnail-view-model, .yt-lockup-view-model__content-image");
      if (!videoId || !thumbnail) continue;
      // Keep the button outside YouTube's thumbnail link so it is its own action.
      const anchor = thumbnail.closest("a");
      const host = anchor ? anchor.parentElement : thumbnail;
      if (!host) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clipse-thumbnail-button";
      const logo = document.createElement("img");
      logo.src = chrome.runtime.getURL("assets/eclipse.svg");
      logo.alt = "";
      logo.draggable = false;
      const text = document.createElement("span");
      button.append(logo, text);
      const entry = {card, host, button, text, videoId, busy: false, pollTimer: null};
      entries.set(card, entry);
      label(entry, "Summarize video with Clipse");
      button.addEventListener("click", event => summarize(entry, event));
      // Avoid one runtime request per thumbnail on large/infinite feeds.
      button.addEventListener("pointerenter", () => void updateStatus(entry));
      button.addEventListener("focus", () => void updateStatus(entry));
      host.classList.add("clipse-thumbnail-host");
      host.appendChild(button);
    }
  }

  const observer = new MutationObserver(() => {
    if (!mountTimer) mountTimer = setTimeout(() => { mountTimer = null; mount(); }, 150);
  });
  observer.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ["href"]});
  document.addEventListener("yt-navigate-finish", mount);
  mount();
})();
