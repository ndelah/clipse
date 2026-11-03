import {loadSettings, summaryConfiguration, sameConfiguration, videoIdFromUrl, videoUrl, parseHistory, mergeSummaries} from "./shared.js";
const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreenDocument = null;
let firefoxWorkerWindowId = null;
const MAX_JOB_AGE_MS = 12 * 60 * 1000;
const STALE_JOB_MS = 75 * 1000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
let stateMutationQueue = Promise.resolve();

/**
 * Chrome can hide extension storage from content scripts. Firefox has no
 * equivalent, so this is skipped there; content scripts still do not read storage.
 * @returns {Promise<void>}
 */
async function configureExtensionSurface() {
  if (typeof chrome.storage?.local?.setAccessLevel === "function") {
    await chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"});
  }
  if (typeof chrome.sidePanel?.setPanelBehavior === "function") {
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
  }
}

/**
 * Open the summary UI for a user action.
 * Chrome uses the side panel. Firefox uses the sidebar, which can only be
 * opened from a browser user-gesture handler such as the toolbar button.
 * Page-button messages still attempt it and ignore the expected rejection.
 * @param {number} windowId
 * @returns {Promise<void>}
 */
function openSummaryPanel(windowId) {
  if (typeof chrome.sidePanel?.open === "function") {
    return Promise.resolve(chrome.sidePanel.open({windowId})).catch(() => {});
  }
  if (typeof chrome.sidebarAction?.open === "function") {
    try {
      return Promise.resolve(chrome.sidebarAction.open()).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }
  return Promise.resolve();
}

if (typeof chrome.sidePanel?.open !== "function" && chrome.sidebarAction?.toggle && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(() => {
    try {
      const result = chrome.sidebarAction.toggle();
      Promise.resolve(result).catch(() => {});
    } catch { /* Sidebar is unavailable in this window. */ }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureExtensionSurface();
  const settings = await loadSettings(chrome.storage.local);
  await chrome.storage.local.set(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await configureExtensionSurface();
});

async function pingOffscreen() {
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "PING"
  });
  return Boolean(response?.ok && response?.ready);
}

/**
 * Chrome offscreen documents are unavailable in Firefox. The same offscreen
 * page runs in a minimized extension window so OpenAI work continues after
 * the sidebar closes and can wake the event page with messages.
 * @returns {boolean}
 */
function supportsOffscreenDocuments() {
  return typeof chrome.runtime.getContexts === "function" && typeof chrome.offscreen?.createDocument === "function";
}

/**
 * @param {string} offscreenUrl
 * @param {{url?: string, pendingUrl?: string}|null|undefined} tab
 * @returns {boolean}
 */
function tabIsOffscreen(offscreenUrl, tab) {
  const url = tab?.pendingUrl || tab?.url || "";
  return url === offscreenUrl;
}

/**
 * @param {string} offscreenUrl
 * @returns {Promise<boolean>}
 */
async function firefoxWorkerWindowOpen(offscreenUrl) {
  if (firefoxWorkerWindowId === null) return false;
  try {
    const win = await chrome.windows.get(firefoxWorkerWindowId, {populate: true});
    const tabs = win?.tabs || [];
    if (tabs.some(tab => tabIsOffscreen(offscreenUrl, tab))) return true;
    // A just-created window may not have committed its extension URL yet.
    if (tabs.length === 1 && !(tabs[0].pendingUrl || tabs[0].url)) return true;
  } catch {
    firefoxWorkerWindowId = null;
  }
  return false;
}

/**
 * @returns {Promise<void>}
 */
async function ensureChromeOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length === 0) {
    if (!creatingOffscreenDocument) {
      creatingOffscreenDocument = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["DOM_PARSER"],
        justification: "Parse YouTube caption documents and run transcript summarization jobs while tabs and the side panel change."
      }).finally(() => {
        creatingOffscreenDocument = null;
      });
    }
    await creatingOffscreenDocument;
  }
}

/**
 * @returns {Promise<void>}
 */
async function ensureFirefoxWorkerWindow() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  if (await firefoxWorkerWindowOpen(offscreenUrl)) return;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tabIsOffscreen(offscreenUrl, tab));
  if (existing?.windowId !== undefined) {
    firefoxWorkerWindowId = existing.windowId;
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.windows.create({
      url: offscreenUrl,
      type: "popup",
      focused: false,
      state: "minimized",
      width: 420,
      height: 240
    }).then(async created => {
      firefoxWorkerWindowId = created?.id ?? null;
      if (created?.id && created.state !== "minimized") {
        await chrome.windows.update(created.id, {state: "minimized"}).catch(() => {});
      }
      return created;
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

/**
 * @returns {Promise<void>}
 */
async function ensureOffscreenDocument() {
  if (supportsOffscreenDocuments()) await ensureChromeOffscreenDocument();
  else await ensureFirefoxWorkerWindow();

  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      if (await pingOffscreen()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw lastError || new Error("The extension worker did not become ready.");
}

async function dispatchJob(jobId) {
  await ensureOffscreenDocument();

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "PROCESS_JOB",
        jobId
      });
      if (response?.ok) return;
      lastError = new Error(response?.error || "The offscreen worker rejected the job.");
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
  }

  throw lastError || new Error("Could not contact the offscreen worker.");
}

async function resumePendingJobs() {
  const {jobs} = await chrome.storage.local.get({jobs: {}});
  const pending = Object.values(jobs).filter(job =>
    ["queued", "running"].includes(job.status)
  );

  for (const job of pending) {
    dispatchJob(job.id).catch(async error => {
      await patchJob(job.id, {
        status: "failed",
        stage: "Failed to start worker",
        error: error instanceof Error ? error.message : String(error)
      }).catch(() => {});
    });
  }
}

function makeJobId(videoId) {
  return `${videoId || "video"}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

async function getState() {
  return chrome.storage.local.get({
    jobs: {},
    summaries: {},
    tabBindings: {},
    latestContexts: {},
    historyUndo: null
  });
}


async function mutateState(mutator) {
  const operation = stateMutationQueue.then(async () => {
    const state = await getState();
    const result = await mutator(state);
    await chrome.storage.local.set({
      jobs: state.jobs,
      summaries: state.summaries,
      tabBindings: state.tabBindings,
      latestContexts: state.latestContexts,
      historyUndo: state.historyUndo
    });
    return result;
  });
  stateMutationQueue = operation.catch(() => {});
  return operation;
}

async function patchJob(jobId, patch, {allowTerminal = false} = {}) {
  return mutateState(state => {
    const current = state.jobs[jobId];
    if (!current) throw new Error("Job not found.");
    if (TERMINAL_STATUSES.has(current.status) && !allowTerminal) return current;

    const nextStatus = patch.status;
    if (TERMINAL_STATUSES.has(current.status) && nextStatus && nextStatus !== current.status) {
      return current;
    }

    state.jobs[jobId] = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    return state.jobs[jobId];
  });
}

async function completeJob(jobId, summary) {
  return mutateState(state => {
    const current = state.jobs[jobId];
    if (!current) throw new Error("Job not found.");
    if (current.status === "cancelled" || current.status === "failed") {
      return {accepted: false, job: current};
    }

    const completedAt = new Date().toISOString();
    const previous = state.summaries[summary.videoId];
    state.summaries[summary.videoId] = {
      ...summary,
      createdAt: previous?.createdAt || summary.createdAt || completedAt,
      updatedAt: completedAt
    };
    state.jobs[jobId] = {
      ...current,
      status: "completed",
      stage: "Complete",
      progress: 100,
      completedAt,
      updatedAt: completedAt,
      error: null
    };
    return {accepted: true, job: state.jobs[jobId]};
  });
}

async function saveContext(tabId, context) {
  if (!tabId || !context) return;
  await mutateState(state => {
    state.latestContexts[String(tabId)] = context;
  });
}

async function startJob(tabId, context, forceRefresh = false, fromThumbnail = false) {
  const settings = await loadSettings(chrome.storage.local);
  if (!settings.apiKey) {
    throw new Error("Add your OpenAI API key in Settings before summarizing.");
  }
  if (settings.classifierProvider === "jev" && !settings.jevApiKey) throw new Error("Add your TypeSafe API key in Settings before using Jev.");

  if (!context?.videoId) {
    throw new Error("YouTube video information is not available yet. Reload the video and try again.");
  }

  const decision = await mutateState(state => {
    const existingSummary = state.summaries[context.videoId];
    if (existingSummary && sameConfiguration(existingSummary.configuration, settings) && !forceRefresh) {
      if (!fromThumbnail) state.tabBindings[String(tabId)] = {
        videoId: context.videoId,
        jobId: existingSummary.jobId,
        url: context.url
      };
      return {jobId: existingSummary.jobId, reused: true, shouldDispatch: false};
    }

    const running = Object.values(state.jobs).find(job =>
      job.videoId === context.videoId && ["queued", "running"].includes(job.status)
    );
    if (running && !sameConfiguration(running.configuration, settings)) {
      throw new Error("This video is already processing with different preferences. Stop that job before starting another.");
    }
    if (running) {
      if (!fromThumbnail) state.tabBindings[String(tabId)] = {
        videoId: context.videoId,
        jobId: running.id,
        url: context.url
      };
      return {jobId: running.id, reused: true, shouldDispatch: false};
    }

    const jobId = makeJobId(context.videoId);
    const now = new Date().toISOString();
    state.jobs[jobId] = {
      id: jobId,
      videoId: context.videoId,
      url: context.url,
      title: context.title || "Untitled YouTube video",
      channel: context.channel || null,
      durationSeconds: context.durationSeconds || null,
      captionTracks: context.captionTracks || [],
      configuration: summaryConfiguration(settings),
      sourceTabId: fromThumbnail ? null : Number(tabId) || null,
      thumbnailTabId: fromThumbnail ? Number(tabId) : null,
      fromThumbnail,
      status: "queued",
      stage: "Waiting to start",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      error: null
    };
    if (!fromThumbnail) state.tabBindings[String(tabId)] = {
      videoId: context.videoId,
      jobId,
      url: context.url
    };
    return {jobId, reused: false, shouldDispatch: true};
  });

  if (!decision.shouldDispatch) return decision;

  try {
    await dispatchJob(decision.jobId);
  } catch (error) {
    await patchJob(decision.jobId, {
      status: "failed",
      stage: "Failed to start worker",
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  return decision;
}


function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function candidateTabsForJob(job, state) {
  const openTabs = await chrome.tabs.query({});
  const matchingIds = new Set(openTabs.filter(tab => videoIdFromUrl(tab.pendingUrl || tab.url) === job.videoId).map(tab => tab.id));
  const candidates = [];
  const add = tabId => {
    if (tabId === null || tabId === undefined || tabId === "") return;
    const numeric = Number(tabId);
    if (matchingIds.has(numeric) && !candidates.includes(numeric)) {
      candidates.push(numeric);
    }
  };

  add(job.sourceTabId);
  for (const [tabId, binding] of Object.entries(state.tabBindings || {})) {
    if (binding?.videoId === job.videoId) add(tabId);
  }
  for (const [tabId, context] of Object.entries(state.latestContexts || {})) {
    if (context?.videoId === job.videoId) add(tabId);
  }

  for (const tab of openTabs) {
    add(tab.id);
  }
  return candidates;
}

async function requestTranscriptFromYouTubeTab(jobId) {
  const state = await getState();
  const job = state.jobs[jobId];
  if (!job) throw new Error("Job not found.");
  if (job.fromThumbnail) return requestThumbnailTranscript(job);

  const candidates = await candidateTabsForJob(job, state);
  if (candidates.length === 0) {
    throw new Error("The original YouTube tab is no longer open. Reopen the video and retry.");
  }

  const errors = [];
  for (const tabId of candidates) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (videoIdFromUrl(tab.pendingUrl || tab.url) !== job.videoId) continue;
      const response = await withTimeout(
        chrome.tabs.sendMessage(tabId, {
          type: "EXTRACT_TRANSCRIPT",
          expectedVideoId: job.videoId,
          captionLanguage: job.configuration?.captionLanguage || "auto"
        }),
        25000,
        "YouTube did not finish rendering its transcript within 25 seconds."
      );
      if (response?.ok && response.transcript?.segments?.length) {
        await patchJob(jobId, {sourceTabId: tabId});
        return response.transcript;
      }
      errors.push(response?.error || `Tab ${tabId} returned no transcript.`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Could not read YouTube captions. ${errors.join(" | ") || "The source tabs changed video. Reopen the video and retry."}`);
}

async function closeThumbnailTab(job) {
  if (!job?.temporaryTabId) return;
  const tabId = job.temporaryTabId;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Keep a tab the user has taken over, activated, or navigated elsewhere.
    const url = tab.pendingUrl || tab.url;
    if (!tab.active && (url === "about:blank" || videoIdFromUrl(url) === job.videoId)) {
      await chrome.tabs.remove(tabId);
    }
  } catch { /* Already closed. */ }
  await mutateState(state => {
    if (state.jobs[job.id]) state.jobs[job.id].temporaryTabId = null;
    delete state.tabBindings[String(tabId)];
    delete state.latestContexts[String(tabId)];
  });
}

async function requestThumbnailTranscript(job) {
  let temporaryTabId = job.temporaryTabId;
  try {
    const currentJob = (await getState()).jobs[job.id];
    if (TERMINAL_STATUSES.has(currentJob?.status)) throw new Error("Summary cancelled.");
    const tabs = await chrome.tabs.query({});
    let tab = tabs.find(tab => tab.id === temporaryTabId && tab.url === "about:blank")
      || tabs.find(tab => videoIdFromUrl(tab.pendingUrl || tab.url) === job.videoId);
    if (!tab || !tab.active) {
      // Fetch by ID from the already-loaded YouTube session. A hidden watch page
      // may never initialize its player, so it cannot be the primary transport.
      const sessionTabs = tabs.filter(tab => {
        try {
          const url = new URL(tab.pendingUrl || tab.url);
          return url.protocol === "https:" && ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname);
        } catch { return false; }
      });
      const sessionTab = sessionTabs.find(tab => tab.id === job.thumbnailTabId) || sessionTabs.find(tab => tab.active) || sessionTabs[0];
      if (sessionTab) {
        const current = await patchJob(job.id, {transcriptRequestTabId: sessionTab.id});
        if (TERMINAL_STATUSES.has(current.status)) throw new Error("Summary cancelled.");
        let response;
        try {
          response = await withTimeout(chrome.tabs.sendMessage(sessionTab.id, {
            type: "EXTRACT_TRANSCRIPT_BY_ID", jobId: job.id, expectedVideoId: job.videoId,
            captionLanguage: job.configuration?.captionLanguage || "auto"
          }), 7000, "YouTube did not finish the thumbnail caption request.");
        } catch {
          await chrome.tabs.sendMessage(sessionTab.id, {type: "CANCEL_TRANSCRIPT_BY_ID", jobId: job.id}).catch(() => {});
        } finally {
          await mutateState(state => {
            if (state.jobs[job.id]?.transcriptRequestTabId === sessionTab.id) state.jobs[job.id].transcriptRequestTabId = null;
          });
        }
        if (TERMINAL_STATUSES.has((await getState()).jobs[job.id]?.status)) throw new Error("Summary cancelled.");
        if (response?.ok && response.transcript?.segments?.length) return response.transcript;
      }
    }
    if (!tab) {
      // Mute before navigation so autoplay cannot interrupt the home feed.
      tab = await chrome.tabs.create({url: "about:blank", active: false});
      temporaryTabId = tab.id;
      const tracked = await patchJob(job.id, {temporaryTabId});
      if (TERMINAL_STATUSES.has(tracked.status)) throw new Error("Summary cancelled.");
    }
    if (tab.id === temporaryTabId && tab.url === "about:blank") {
      await chrome.tabs.update(tab.id, {muted: true});
      await chrome.tabs.update(tab.id, {url: videoUrl(job.videoId)});
    }
    const target = await contextForVideo(job.videoId, tab.id, tab.id === temporaryTabId);
    const current = await patchJob(job.id, {
      sourceTabId: tab.id,
      title: target.context.title || job.title,
      channel: target.context.channel || job.channel,
      durationSeconds: target.context.durationSeconds || job.durationSeconds
    });
    if (TERMINAL_STATUSES.has(current.status)) throw new Error("Summary cancelled.");
    const response = await withTimeout(chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_TRANSCRIPT", expectedVideoId: job.videoId,
      captionLanguage: job.configuration?.captionLanguage || "auto"
    }), 25000, "YouTube did not finish reading captions within 25 seconds.");
    if (!response?.ok || !response.transcript?.segments?.length) {
      throw new Error(response?.error || "This video has no readable captions.");
    }
    return response.transcript;
  } finally {
    await closeThumbnailTab({...job, temporaryTabId});
  }
}


async function cancelJob(jobId) {
  const job = await patchJob(jobId, {
    status: "cancelled",
    stage: "Cancelled",
    cancelRequested: true,
    error: null
  });

  await ensureOffscreenDocument().catch(() => {});
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "CANCEL_JOB",
    jobId
  }).catch(() => {});

  if (job?.sourceTabId) {
    await chrome.tabs.sendMessage(job.sourceTabId, {type: "CANCEL_TRANSCRIPT"}).catch(() => {});
  }
  if (job?.transcriptRequestTabId != null) {
    await chrome.tabs.sendMessage(job.transcriptRequestTabId, {type: "CANCEL_TRANSCRIPT_BY_ID", jobId}).catch(() => {});
  }
  await closeThumbnailTab(job);

  return {jobId, status: job.status};
}

async function failStaleJobs() {
  const state = await getState();
  const now = Date.now();
  const staleJobs = [];

  for (const job of Object.values(state.jobs)) {
    if (!["queued", "running"].includes(job.status)) continue;
    const created = new Date(job.createdAt || 0).getTime();
    const updated = new Date(job.updatedAt || job.createdAt || 0).getTime();
    const tooOld = now - created > MAX_JOB_AGE_MS;
    const stale = now - updated > STALE_JOB_MS;
    if (tooOld || stale) staleJobs.push({job, tooOld});
  }

  for (const {job, tooOld} of staleJobs) {
    await patchJob(job.id, {
      status: "failed",
      stage: "Timed out",
      error: tooOld
        ? "The summarization exceeded the 12-minute job limit."
        : "The processor stopped reporting progress for more than 75 seconds."
    });
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "CANCEL_JOB",
      jobId: job.id
    }).catch(() => {});
    await closeThumbnailTab(job);
  }
}

async function findVideoTab(videoId, active = false) {
  const url = videoUrl(videoId);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => videoIdFromUrl(tab.pendingUrl || tab.url) === videoId);
  if (existing) {
    if (active) {
      await chrome.tabs.update(existing.id, {active: true});
      await chrome.windows.update(existing.windowId, {focused: true});
    }
    return existing;
  }
  return chrome.tabs.create({url, active});
}

async function seekSummary(videoId, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid timestamp.");
  const tab = await findVideoTab(videoId, true);
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {type: "SEEK_VIDEO", expectedVideoId: videoId, seconds});
    if (response?.ok) return {tabId: tab.id};
  } catch { /* A new or reloaded tab may not have its content script yet. */ }
  // A canonical timestamp URL also works when the content script has not loaded.
  await chrome.tabs.update(tab.id, {url: videoUrl(videoId, seconds), active: true});
  return {tabId: tab.id};
}

async function contextForVideo(videoId, sourceTabId = null, pausePlayback = false) {
  const tab = sourceTabId === null ? await findVideoTab(videoId) : await chrome.tabs.get(sourceTabId);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const current = await chrome.tabs.get(tab.id);
    if (videoIdFromUrl(current.pendingUrl || current.url) !== videoId) throw new Error("The source tab changed video. Try again.");
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {type: "GET_VIDEO_CONTEXT", expectedVideoId: videoId, pausePlayback});
      if (response?.context?.videoId === videoId && response.context.playerReady !== false) return {tabId: tab.id, context: response.context};
    } catch { /* Wait for the new tab's content script. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Could not read the saved video's tab. Reload it and try again.");
}

async function validateSettings(settings) {
  const apiKey = String(settings?.apiKey || "").trim();
  const config = summaryConfiguration(settings);
  if (!apiKey) throw new Error("Enter your OpenAI API key first.");
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`, {
    headers: {Authorization: `Bearer ${apiKey}`}, signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("OpenAI rejected this key. Check it and try again.");
    if (response.status === 404 || response.status === 403) throw new Error("This key cannot access that model. Check the model name and project permissions.");
    if (response.status === 429) throw new Error("OpenAI is rate limiting requests. Try validation again shortly.");
    throw new Error(`Could not validate access (HTTP ${response.status}).`);
  }
  return {message: "Key and model access verified. Summary requests require available API credit."};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return false;
  const fromContent = sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""));
  if (fromContent && !["VIDEO_CONTEXT_UPDATED", "START_PLAYER_JOB", "GET_PLAYER_STATUS", "START_THUMBNAIL_JOB", "GET_THUMBNAIL_STATUS"].includes(message?.type)) return false;
  let panelOpening = Promise.resolve();
  if (["START_THUMBNAIL_JOB", "GET_THUMBNAIL_STATUS"].includes(message?.type)) {
    let validSender = false;
    try {
      const url = new URL(sender.url);
      validSender = url.protocol === "https:" && ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname);
    } catch { /* Invalid sender URL. */ }
    if (!fromContent || sender.frameId !== 0 || !validSender || !/^[\w-]{11}$/.test(message.videoId || "")) {
      sendResponse({ok: false, error: "Choose a YouTube video thumbnail and try again."});
      return false;
    }
    if (message.type === "START_THUMBNAIL_JOB") {
      panelOpening = openSummaryPanel(sender.tab.windowId);
    }
  }
  if (["START_PLAYER_JOB", "GET_PLAYER_STATUS"].includes(message?.type)) {
    // Derive the target from the browser's sender, never a page-supplied tab ID.
    if (!fromContent || sender.frameId !== 0 || videoIdFromUrl(sender.url) !== message.videoId) {
      sendResponse({ok: false, error: "Open this YouTube video and try again."});
      return false;
    }
    if (message.type === "START_PLAYER_JOB") {
      // Must happen before any await to preserve the button's user gesture.
      panelOpening = openSummaryPanel(sender.tab.windowId);
    }
  }

  (async () => {
    if (["GET_PLAYER_STATUS", "GET_THUMBNAIL_STATUS"].includes(message?.type)) {
      const {jobs, summaries} = await getState();
      const job = Object.values(jobs).filter(job => job.videoId === message.videoId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      const status = ["queued", "running"].includes(job?.status) ? "running"
        : job?.status === "failed" ? "failed" : summaries[message.videoId] ? "completed" : "ready";
      sendResponse({ok: true, status, stage: job?.stage, error: job?.error});
      return;
    }
    if (message?.type === "START_THUMBNAIL_JOB") {
      const result = await startJob(sender.tab.id, {
        videoId: message.videoId, url: videoUrl(message.videoId),
        title: String(message.title || "Untitled YouTube video").slice(0, 500)
      }, false, true);
      await panelOpening;
      sendResponse({ok: true, ...result});
      return;
    }
    if (message?.type === "START_PLAYER_JOB") {
      const target = await contextForVideo(message.videoId, sender.tab.id);
      if (videoIdFromUrl((await chrome.tabs.get(target.tabId)).url) !== message.videoId) throw new Error("This tab has changed video. Click Clipse on the new video.");
      const result = await startJob(target.tabId, target.context);
      await panelOpening;
      sendResponse({ok: true, ...result});
      return;
    }
    if (message?.target === "service-worker" && message?.type === "GET_JOB") {
      const state = await getState();
      sendResponse({ok: true, job: state.jobs[message.jobId] || null});
      return;
    }

    if (message?.target === "service-worker" && message?.type === "GET_SETTINGS") {
      const settings = await loadSettings(chrome.storage.local);
      sendResponse({ok: true, settings});
      return;
    }

    if (message?.target === "service-worker" && message?.type === "GET_TRANSCRIPT") {
      const transcript = await requestTranscriptFromYouTubeTab(message.jobId);
      sendResponse({ok: true, transcript});
      return;
    }

    if (message?.target === "service-worker" && message?.type === "PATCH_JOB") {
      const job = await patchJob(message.jobId, message.patch || {});
      sendResponse({ok: true, job});
      return;
    }

    if (message?.target === "service-worker" && message?.type === "COMPLETE_JOB") {
      const result = await completeJob(message.jobId, message.summary);
      sendResponse({ok: true, ...result});
      return;
    }
    if (message?.type === "VIDEO_CONTEXT_UPDATED") {
      await saveContext(sender.tab?.id, message.context);
      sendResponse({ok: true});
      return;
    }

    if (message?.type === "START_JOB") {
      const target = message.videoId ? await contextForVideo(message.videoId) : {tabId: message.tabId, context: message.context};
      if (!target.context?.videoId || videoIdFromUrl((await chrome.tabs.get(target.tabId)).url) !== target.context.videoId) {
        throw new Error("This tab has changed video. Click Clipse on the new video and try again.");
      }
      const result = await startJob(target.tabId, target.context, Boolean(message.forceRefresh));
      sendResponse({ok: true, ...result});
      return;
    }

    if (message?.type === "SEEK_SUMMARY") {
      const result = await seekSummary(message.videoId, message.seconds);
      sendResponse({ok: true, ...result});
      return;
    }

    if (message?.type === "IMPORT_HISTORY") {
      const parsed = parseHistory(message.payload);
      const result = await mutateState(state => mergeSummaries(state.summaries, parsed.summaries));
      sendResponse({ok: true, ...result, skipped: parsed.skipped});
      return;
    }

    if (message?.type === "DISMISS_ERROR") {
      await mutateState(state => {
        const job = state.jobs[message.jobId];
        if (!job || job.status !== "failed") throw new Error("This error is no longer available.");
        job.dismissedAt = new Date().toISOString();
      });
      sendResponse({ok: true});
      return;
    }

    if (message?.type === "DELETE_HISTORY") {
      const result = await mutateState(state => {
        const records = message.videoId ? [state.summaries[message.videoId]].filter(Boolean) : Object.values(state.summaries);
        if (!records.length) return {count: 0};
        state.historyUndo = {records};
        for (const record of records) delete state.summaries[record.videoId];
        return {count: records.length};
      });
      sendResponse({ok: true, ...result});
      return;
    }

    if (message?.type === "UNDO_HISTORY") {
      const result = await mutateState(state => {
        const restored = mergeSummaries(state.summaries, state.historyUndo?.records || []);
        state.historyUndo = null;
        return restored;
      });
      sendResponse({ok: true, ...result});
      return;
    }

    if (message?.type === "RELOAD_VIDEO") {
      const tab = await findVideoTab(message.videoId, true);
      await chrome.tabs.reload(tab.id);
      sendResponse({ok: true});
      return;
    }

    if (message?.type === "VALIDATE_SETTINGS") {
      const result = await validateSettings(message.settings);
      sendResponse({ok: true, ...result});
      return;
    }

    if (message?.type === "ENSURE_OFFSCREEN") {
      await ensureOffscreenDocument();
      sendResponse({ok: true});
      return;
    }

    if (message?.type === "RESUME_JOB") {
      await dispatchJob(message.jobId);
      sendResponse({ok: true});
      return;
    }

    if (message?.type === "CANCEL_JOB") {
      const result = await cancelJob(message.jobId);
      sendResponse({ok: true, ...result});
      return;
    }

    if (message?.type === "WORKER_HEALTH") {
      await ensureOffscreenDocument();
      sendResponse({ok: true, ready: true});
      return;
    }

    sendResponse({ok: false, error: "Unknown message."});
  })().catch(error => {
    sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)});
  });

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  resumePendingJobs();
});

chrome.runtime.onStartup.addListener(() => {
  resumePendingJobs();
});

chrome.alarms.create("resume-video-preview-jobs", {periodInMinutes: 1});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "resume-video-preview-jobs") {
    failStaleJobs().then(resumePendingJobs).catch(() => {});
  }
});
