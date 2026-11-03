let latestContext = null;
let runtimeInvalidated = false;
let activeTranscriptController = null;
const thumbnailTranscriptControllers = new Map();

function runtimeIsAvailable() {
  return !runtimeInvalidated && Boolean(globalThis.chrome?.runtime?.id);
}

function markRuntimeInvalidated(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    message.includes("Extension context invalidated") ||
    message.includes("Receiving end does not exist")
  ) {
    runtimeInvalidated = true;
    window.removeEventListener("message", handlePageMessage);
    activeTranscriptController?.abort();
    for (const controller of thumbnailTranscriptControllers.values()) controller.abort();
    return true;
  }
  return false;
}

async function safelySendRuntimeMessage(message) {
  if (!runtimeIsAvailable()) return null;

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (!markRuntimeInvalidated(error)) {
      console.warn("Video Preview could not contact the extension worker:", error);
    }
    return null;
  }
}

function handlePageMessage(event) {
  if (event.source !== window) return;
  if (event.data?.source !== "video-preview-page-context") return;
  if (event.data?.type !== "VIDEO_CONTEXT") return;

  latestContext = event.data.payload;
  void safelySendRuntimeMessage({
    type: "VIDEO_CONTEXT_UPDATED",
    context: latestContext
  });
}

window.addEventListener("message", handlePageMessage);

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException("Transcript extraction was cancelled.", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Transcript extraction was cancelled.", "AbortError"));
    }, {once: true});
  });
}

function parseTimestamp(value) {
  const match = String(value || "").trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSegmentFromNode(node) {
  const timestampNode = node.querySelector(
    ".segment-timestamp, [class*='Timestamp'], [class*='timestamp'], [aria-label*='minute'], [aria-label*='second']"
  );
  const textNode = node.querySelector(
    ".segment-text, [role='text'], .ytAttributedStringHost, .yt-core-attributed-string, [class*='TranscriptSegmentViewModelText'], [class*='segmentText'], yt-formatted-string:not(.segment-timestamp)"
  );

  let timestampText = cleanText(timestampNode?.textContent || timestampNode?.getAttribute?.("aria-label"));
  let text = cleanText(textNode?.textContent);

  if (!timestampText || !text) {
    const lines = String(node.innerText || "")
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);
    const timestampIndex = lines.findIndex(line => parseTimestamp(line) !== null);
    if (!timestampText && timestampIndex >= 0) timestampText = lines[timestampIndex];
    if (!text && timestampIndex >= 0) {
      text = cleanText(lines.filter((_, index) => index !== timestampIndex).join(" "));
    }
  }

  const startSeconds = parseTimestamp(timestampText);
  if (startSeconds === null || !text) return null;
  return {startSeconds, durationSeconds: 0, text};
}

function collectTranscriptSegments() {
  const root = getTranscriptPanel() || document;
  const selectors = [
    "ytd-transcript-segment-renderer",
    "transcript-segment-view-model",
    "[class*='TranscriptSegmentViewModelHost']",
    "[data-segment-id]"
  ];

  const nodes = [];
  const seenNodes = new Set();
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      if (!seenNodes.has(node)) {
        seenNodes.add(node);
        nodes.push(node);
      }
    }
  }

  const byTimestamp = new Map();
  for (const node of nodes) {
    const segment = extractSegmentFromNode(node);
    if (!segment) continue;
    const existing = byTimestamp.get(segment.startSeconds);
    if (!existing || segment.text.length > existing.text.length) {
      byTimestamp.set(segment.startSeconds, segment);
    }
  }

  const segments = [...byTimestamp.values()].sort((a, b) => a.startSeconds - b.startSeconds);
  for (let index = 0; index < segments.length; index += 1) {
    const next = segments[index + 1];
    segments[index].durationSeconds = next
      ? Math.max(0, next.startSeconds - segments[index].startSeconds)
      : 0;
  }
  return segments;
}

function getTranscriptPanel() {
  // Modern YouTube panels can omit target-id entirely. Prefer the visible panel
  // containing transcript content over a hidden legacy panel left in the DOM.
  const panels = [...document.querySelectorAll("ytd-engagement-panel-section-list-renderer")]
    .filter(panel => /transcript/i.test(panel.getAttribute("target-id") || "") || panel.querySelector(
      "ytd-transcript-renderer, ytd-transcript-segment-renderer, transcript-segment-view-model, [class*='TranscriptSegmentViewModelHost'], [data-target-id='PAmodern_transcript_view']"
    ));
  return panels.find(panelIsVisible) || panels[0] || document.querySelector(
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']"
  );
}

function panelIsVisible(panel) {
  if (!panel || panel.hidden || panel.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN") {
    return false;
  }
  const rect = panel.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function transcriptPanelIsVisible() {
  return panelIsVisible(getTranscriptPanel());
}

function clickElement(element, scroll = false) {
  if (!element) return false;
  const clickable = element.matches("button, tp-yt-paper-button")
    ? element
    : element.querySelector("button, tp-yt-paper-button") || element;
  if (scroll) clickable.scrollIntoView({block: "center", behavior: "instant"});
  clickable.click();
  return true;
}

function findTranscriptButton() {
  const isTrigger = element => {
    // A failed Clipse control can itself contain "transcript" in its aria-label.
    if (element.id?.startsWith("clipse-") || element.closest?.("[id^='clipse-'], .clipse-thumbnail-button")) return false;
    const panel = element.closest?.("ytd-engagement-panel-section-list-renderer");
    if (panel && panel === getTranscriptPanel()) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const structuralSelectors = [
    "ytd-video-description-transcript-section-renderer button",
    "ytd-video-description-transcript-section-renderer tp-yt-paper-button",
    "ytd-video-description-transcript-section-renderer #primary-button",
    "ytd-video-description-transcript-section-renderer yt-button-shape",
    "button[aria-label*='transcript' i]",
    "tp-yt-paper-button[aria-label*='transcript' i]"
  ];

  for (const selector of structuralSelectors) {
    const element = [...document.querySelectorAll(selector)].find(isTrigger);
    if (element) return element;
  }

  const labels = [
    "show transcript", "transcript", "afficher la transcription",
    "transcript weergeven", "transcript tonen", "transkript anzeigen",
    "mostrar transcripción", "mostrar transcrição", "mostra trascrizione"
  ];
  for (const candidate of document.querySelectorAll("button, tp-yt-paper-button, yt-button-shape")) {
    if (!isTrigger(candidate)) continue;
    const label = cleanText(candidate.getAttribute("aria-label") || candidate.textContent).toLowerCase();
    if (labels.some(value => label === value || label.includes(value))) return candidate;
  }
  return null;
}

function expandDescription() {
  const selectors = [
    "#description-inline-expander #expand",
    "ytd-text-inline-expander #expand",
    "ytd-watch-metadata #description #expand",
    "tp-yt-paper-button#expand"
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const rect = element.getBoundingClientRect?.();
      if (rect && (!rect.width || !rect.height)) continue;
      clickElement(element, false);
      return true;
    }
  }
  return false;
}

async function waitForTranscriptButton(expectedVideoId, signal, onExpand, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let expanded = false;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("Transcript extraction was cancelled.", "AbortError");
    if (expectedVideoId && currentVideoId() !== expectedVideoId) throw new Error("This tab has changed video during extraction.");
    // The description and its transcript action can arrive in separate renders.
    if (transcriptPanelIsVisible()) return null;
    const button = findTranscriptButton();
    if (button) return button;
    if (!expanded) {
      expanded = expandDescription();
      if (expanded) onExpand();
    }
    await sleep(200, signal);
  }
  throw new Error("Could not find YouTube's Show transcript control after waiting for the description to load. This does not mean the video has no captions.");
}

async function waitForTranscriptSegments(signal, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs;
  let previousCount = 0;
  let stablePasses = 0;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new DOMException("Transcript extraction was cancelled.", "AbortError");
    const segments = collectTranscriptSegments();
    if (segments.length >= 2) {
      if (segments.length === previousCount) stablePasses += 1;
      else stablePasses = 0;
      previousCount = segments.length;
      if (stablePasses >= 2) return segments;
    }
    await sleep(300, signal);
  }

  const finalSegments = collectTranscriptSegments();
  if (finalSegments.length > 0) return finalSegments;
  throw new Error("YouTube did not render transcript rows after the transcript panel was opened.");
}

function currentVideoId() {
  const url = new URL(location.href);
  return url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1] || null;
}

function selectedTranscriptMetadata() {
  const panel = getTranscriptPanel();
  const label = cleanText(panel?.querySelector(
    "ytd-transcript-footer-renderer #label, ytd-transcript-renderer #footer #label, ytd-transcript-renderer [role='combobox']"
  )?.textContent);
  const normalize = value => cleanText(value).toLocaleLowerCase();
  const track = (latestContext?.captionTracks || []).find(item => label && normalize(item.name) === normalize(label));
  return {
    language: label || "Language unavailable",
    languageCode: track?.languageCode || "unknown",
    isGenerated: track ? track.kind === "asr" : null
  };
}

function captionTrackKey(track) { return `${track.languageCode}:${track.kind || "manual"}`; }

async function fetchDirectTranscript(expectedVideoId, signal, selectedTrack = null) {
  const track = selectedTrack || latestContext?.captionTracks?.find(track => track.kind !== "asr") || latestContext?.captionTracks?.[0];
  if (!track?.baseUrl) return null;
  const url = new URL(track.baseUrl);
  if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)
    || url.pathname !== "/api/timedtext" || (expectedVideoId && url.searchParams.get("v") !== expectedVideoId)) return null;
  url.searchParams.set("fmt", "json3");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, {once: true});
  const timer = setTimeout(cancel, 4000);
  try {
    if (signal.aborted) throw new DOMException("Transcript extraction was cancelled.", "AbortError");
    const response = await fetch(url.href, {credentials: "include", signal: controller.signal});
    if (!response.ok) return null;
    const data = await response.json();
    const segments = (data.events || []).map(event => ({
      startSeconds: Number(event.tStartMs) / 1000,
      durationSeconds: Number(event.dDurationMs || 0) / 1000,
      text: cleanText((event.segs || []).map(segment => segment.utf8 || "").join(""))
    })).filter(segment => Number.isFinite(segment.startSeconds) && segment.startSeconds >= 0 && segment.text)
      .sort((a, b) => a.startSeconds - b.startSeconds);
    if (!segments.length) return null;
    return {language: track.name || track.languageCode || "Language unavailable", languageCode: track.languageCode || "unknown",
      isGenerated: track.kind ? track.kind === "asr" : false, source: "youtube_caption_json3", segments};
  } catch (error) {
    if (signal.aborted) throw new DOMException("Transcript extraction was cancelled.", "AbortError");
    return null; // Some YouTube sessions return empty or blocked caption responses; use rendered rows.
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

function fetchPageTranscript(expectedVideoId, signal, captionLanguage = "auto", byId = false) {
  if (!byId && (!(latestContext?.canFetchTranscript || latestContext?.hasTranscriptEndpoint || latestContext?.playerReady === true)
    || latestContext.videoId !== expectedVideoId)) return Promise.resolve(null);
  if (signal.aborted) return Promise.reject(new DOMException("Transcript extraction was cancelled.", "AbortError"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (transcript, cancelled = false) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      if (!transcript) window.postMessage({source: "video-preview-content-script", type: "CANCEL_TRANSCRIPT_REQUEST", requestId}, "*");
      if (cancelled) reject(new DOMException("Transcript extraction was cancelled.", "AbortError"));
      else resolve(transcript);
    };
    const receive = event => {
      const data = event.data;
      if (event.source !== window || data?.source !== "video-preview-page-context" || data.type !== "TRANSCRIPT_RESULT"
        || data.requestId !== requestId || data.videoId !== expectedVideoId) return;
      const transcript = data.transcript;
      const valid = (byId || currentVideoId() === expectedVideoId) && transcript?.segments?.length
        && transcript.segments.every(segment => Number.isFinite(segment.startSeconds) && segment.startSeconds >= 0 && typeof segment.text === "string" && segment.text.trim())
        && (captionLanguage === "auto" || (typeof transcript.isGenerated === "boolean"
          && `${transcript.languageCode}:${transcript.isGenerated ? "asr" : "manual"}` === captionLanguage));
      finish(valid ? transcript : null);
    };
    const abort = () => finish(null, true);
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, {once: true});
    timer = setTimeout(() => finish(null), 6200);
    window.postMessage({source: "video-preview-content-script", type: byId ? "REQUEST_TRANSCRIPT_BY_ID" : "REQUEST_TRANSCRIPT", expectedVideoId, captionLanguage, requestId}, "*");
  });
}

function closeTranscriptPanel() {
  if (!transcriptPanelIsVisible()) return;
  const panel = getTranscriptPanel();
  const close = panel?.querySelector(
    "ytd-engagement-panel-title-header-renderer #visibility-button, #header #visibility-button, #header #close-button, #header button[aria-label*='close' i]"
  );
  if (close) clickElement(close);
}

async function selectRenderedCaptionTrack(track, signal) {
  const matches = () => {
    const metadata = selectedTranscriptMetadata();
    return metadata.languageCode === track.languageCode && metadata.isGenerated === (track.kind === "asr");
  };
  if (matches()) return;
  const panel = getTranscriptPanel();
  const selector = panel?.querySelector("ytd-transcript-footer-renderer button, ytd-transcript-footer-renderer tp-yt-paper-menu-button, [role='combobox']");
  if (!selector) throw new Error("YouTube could not select these captions. Choose Best available or select the language in YouTube's transcript panel and retry.");
  clickElement(selector);
  await sleep(250, signal);
  const choice = [...document.querySelectorAll("ytd-menu-service-item-renderer, tp-yt-paper-item, [role='option'], [role='menuitem']")]
    .find(item => cleanText(item.textContent).toLocaleLowerCase() === cleanText(track.name || track.languageCode).toLocaleLowerCase());
  if (!choice) throw new Error("YouTube does not expose the requested caption language. Choose Best available and retry.");
  clickElement(choice);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(300, signal);
    if (matches()) return;
  }
  throw new Error("Could not verify the selected caption language. Choose Best available and retry.");
}

async function extractTranscriptFromPage({expectedVideoId, captionLanguage = "auto"}, signal) {
  // Leave time for cleanup before the worker's 25-second message deadline.
  const deadline = Date.now() + 23000;
  window.postMessage({source: "video-preview-content-script", type: "REQUEST_VIDEO_CONTEXT"}, "*");
  await sleep(150, signal);
  if (expectedVideoId && currentVideoId() !== expectedVideoId) throw new Error("This tab has navigated to a different YouTube video.");
  // A thumbnail's background tab and SPA navigation can publish before player data.
  const contextDeadline = Date.now() + 3000;
  while ((!latestContext || latestContext.videoId !== expectedVideoId || latestContext.playerReady === false) && Date.now() < contextDeadline) {
    await sleep(200, signal);
    if (currentVideoId() !== expectedVideoId) throw new Error("This tab has changed video during extraction.");
    window.postMessage({source: "video-preview-content-script", type: "REQUEST_VIDEO_CONTEXT"}, "*");
  }
  if (latestContext?.videoId !== expectedVideoId || latestContext.playerReady === false) throw new Error("YouTube's video data is still loading. Reload the video and retry.");

  const tracks = latestContext?.captionTracks || [];
  const requestedTrack = captionLanguage === "auto" ? null : tracks.find(track => captionTrackKey(track) === captionLanguage);
  if (captionLanguage !== "auto" && !requestedTrack) throw new Error("The requested captions are unavailable on this video. Choose Best available in Settings or on the video and retry.");
  const wasOpen = transcriptPanelIsVisible();
  const wasExpanded = Boolean(document.querySelector("ytd-watch-metadata #description-inline-expander[is-expanded], ytd-watch-metadata ytd-text-inline-expander[is-expanded]"));
  let openedByClipse = false;
  let expandedByClipse = false;
  try {
    let segments = collectTranscriptSegments();
    if (requestedTrack || (!segments.length && !wasOpen)) {
      const pageTranscript = await fetchPageTranscript(expectedVideoId, signal, captionLanguage);
      if (pageTranscript) return pageTranscript;
      const direct = await fetchDirectTranscript(expectedVideoId, signal, requestedTrack);
      if (signal.aborted) throw new DOMException("Transcript extraction was cancelled.", "AbortError");
      if (expectedVideoId && currentVideoId() !== expectedVideoId) throw new Error("This tab has changed video during extraction.");
      if (direct) return direct;
    }
    if (!segments.length || (requestedTrack && !wasOpen)) {
      if (!wasOpen) {
        const button = await waitForTranscriptButton(expectedVideoId, signal, () => { expandedByClipse = !wasExpanded; }, Math.min(5000, Math.max(0, deadline - Date.now())));
        if (button) {
          openedByClipse = true;
          clickElement(button);
        }
      }
      segments = await waitForTranscriptSegments(signal, Math.min(18000, Math.max(0, deadline - Date.now() - (requestedTrack ? 3500 : 0))));
    }
    if (requestedTrack) {
      await selectRenderedCaptionTrack(requestedTrack, signal);
      segments = await waitForTranscriptSegments(signal, Math.min(18000, Math.max(0, deadline - Date.now())));
    }
    if (signal.aborted) throw new DOMException("Transcript extraction was cancelled.", "AbortError");
    if (expectedVideoId && currentVideoId() !== expectedVideoId) throw new Error("This tab has changed video during extraction.");
    return {...selectedTranscriptMetadata(), source: "youtube_transcript_panel", segments};
  } finally {
    // Preserve a panel the user opened, and clean up our own UI even on failure/cancel.
    if (!expectedVideoId || currentVideoId() === expectedVideoId) {
      if (openedByClipse) closeTranscriptPanel();
      if (expandedByClipse) {
        const collapse = document.querySelector("ytd-watch-metadata #description-inline-expander #collapse, ytd-watch-metadata ytd-text-inline-expander #collapse");
        if (collapse) clickElement(collapse);
      }
    }
  }
}

if (runtimeIsAvailable()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!runtimeIsAvailable()) return false;

    if (message?.type === "GET_VIDEO_CONTEXT") {
      if (message.pausePlayback && message.expectedVideoId === currentVideoId()) document.querySelector("video")?.pause();
      window.postMessage({
        source: "video-preview-content-script",
        type: "REQUEST_VIDEO_CONTEXT"
      }, "*");

      setTimeout(() => {
        try {
          sendResponse({ok: true, context: latestContext});
        } catch (error) {
          markRuntimeInvalidated(error);
        }
      }, 120);
      return true;
    }

    if (message?.type === "EXTRACT_TRANSCRIPT") {
      activeTranscriptController?.abort();
      const controller = new AbortController();
      activeTranscriptController = controller;
      extractTranscriptFromPage(message, controller.signal)
        .then(transcript => sendResponse({ok: true, transcript}))
        .catch(error => sendResponse({
          ok: false,
          error: error?.name === "AbortError"
            ? "Transcript extraction was cancelled."
            : (error instanceof Error ? error.message : String(error))
        }))
        .finally(() => {
          if (activeTranscriptController === controller) activeTranscriptController = null;
        });
      return true;
    }

    if (message?.type === "EXTRACT_TRANSCRIPT_BY_ID") {
      if (!/^[\w-]{11}$/.test(message.expectedVideoId || "") || typeof message.jobId !== "string" || message.jobId.length > 100) {
        sendResponse({ok: false, error: "Invalid thumbnail transcript request."});
        return false;
      }
      thumbnailTranscriptControllers.get(message.jobId)?.abort();
      const controller = new AbortController();
      thumbnailTranscriptControllers.set(message.jobId, controller);
      fetchPageTranscript(message.expectedVideoId, controller.signal, message.captionLanguage || "auto", true)
        .then(transcript => sendResponse(transcript ? {ok: true, transcript} : {ok: false, error: "YouTube did not return captions for this thumbnail."}))
        .catch(error => sendResponse({ok: false, error: error?.name === "AbortError" ? "Transcript extraction was cancelled." : String(error)}))
        .finally(() => {
          if (thumbnailTranscriptControllers.get(message.jobId) === controller) thumbnailTranscriptControllers.delete(message.jobId);
        });
      return true;
    }

    if (message?.type === "CANCEL_TRANSCRIPT_BY_ID") {
      thumbnailTranscriptControllers.get(message.jobId)?.abort();
      sendResponse({ok: true});
      return false;
    }

    if (message?.type === "CANCEL_TRANSCRIPT") {
      activeTranscriptController?.abort();
      sendResponse({ok: true});
      return false;
    }

    if (message?.type === "SEEK_VIDEO") {
      const video = document.querySelector("video");
      const seconds = Number(message.seconds);

      if (message.expectedVideoId !== currentVideoId() || (latestContext?.videoId && latestContext.videoId !== message.expectedVideoId)) {
        sendResponse({ok: false, error: "This tab is showing a different video."});
        return false;
      }
      if (!video || !Number.isFinite(seconds) || seconds < 0) {
        sendResponse({ok: false, error: "Could not seek this video."});
        return false;
      }

      video.currentTime = seconds;
      video.play().catch(() => {});
      sendResponse({ok: true});
      return false;
    }

    return false;
  });
}
