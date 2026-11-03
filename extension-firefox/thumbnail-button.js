// Runs in the isolated extension world after content-script.js.
(() => {
  const cards = "ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model, .yt-lockup-view-model";
  const entries = new Map();
  let mountTimer = null, preview = null, previewEntry = null;

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
    const heading = entry.card.querySelector("#video-title, .yt-lockup-metadata-view-model__title, [role='heading'], h3 a, h3");
    // Some cards render the visible text lazily; the title attribute is set up front.
    const title = heading?.textContent?.trim() || heading?.getAttribute?.("title")?.trim() || undefined;
    const author = entry.card.querySelector("ytd-channel-name #text, ytd-channel-name a, .yt-lockup-metadata-view-model__metadata a[href^='/@'], .yt-lockup-metadata-view-model__metadata a[href^='/channel/'], .yt-content-metadata-view-model__metadata-row a");
    const channel = author?.textContent?.trim() || undefined;
    const response = await safelySendRuntimeMessage({type: "START_THUMBNAIL_JOB", videoId: entry.videoId, title, ...(channel ? {channel} : {})});
    if (!current(entry)) return;
    entry.busy = false;
    if (!response?.ok) {
      label(entry, response?.error || "Clipse could not start. Reload YouTube and try again.", "failed");
    } else await updateStatus(entry);
  }

  function unlend(entry) {
    entry.button.classList.remove("clipse-thumbnail-preview");
    entry.button.style.top = entry.button.style.left = "";
    if (entry.button.parentElement !== entry.host) entry.host.appendChild(entry.button);
  }

  // YouTube's hover preview mounts outside the card, above the page's stacking
  // context, and covers the thumbnail after ~500ms. Lend the covered card's button
  // to the preview while it plays so it stays visible and clickable.
  function syncPreview() {
    const box = preview?.isConnected ? preview.getBoundingClientRect() : null;
    let target = null;
    if (box?.width && box.height) {
      for (const entry of entries.values()) {
        const rect = entry.host.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        if (rect.width && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) { target = entry; break; }
      }
    }
    if (previewEntry && previewEntry !== target && entries.get(previewEntry.card) === previewEntry) unlend(previewEntry);
    previewEntry = target;
    if (!target) return;
    const rect = target.host.getBoundingClientRect();
    target.button.style.top = `${Math.max(8, rect.top - box.top + 8)}px`;
    target.button.style.left = `${Math.max(8, rect.left - box.left + 8)}px`;
    target.button.classList.add("clipse-thumbnail-preview");
    if (target.button.parentElement !== preview) preview.appendChild(target.button);
  }

  const previewObserver = new MutationObserver(syncPreview);

  function watchPreview() {
    const found = document.querySelector("ytd-video-preview");
    if (found === preview) return;
    previewObserver.disconnect();
    preview = found;
    if (preview) previewObserver.observe(preview, {attributes: true, attributeFilter: ["class", "style", "hidden"]});
    syncPreview();
  }

  function remove(entry) {
    clearTimeout(entry.pollTimer);
    if (previewEntry === entry) previewEntry = null;
    entry.button.remove();
    entry.host.classList.remove("clipse-thumbnail-host");
    entries.delete(entry.card);
  }

  function mount() {
    if (!runtimeIsAvailable()) {
      observer.disconnect();
      previewObserver.disconnect();
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
    watchPreview();
  }

  const observer = new MutationObserver(() => {
    if (!mountTimer) mountTimer = setTimeout(() => { mountTimer = null; mount(); }, 150);
  });
  observer.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ["href"]});
  document.addEventListener("yt-navigate-finish", mount);
  mount();
})();
