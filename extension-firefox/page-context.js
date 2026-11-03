(() => {
  const SOURCE = "video-preview-page-context";

  function currentVideoId() {
    const url = new URL(location.href);
    return url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1] || null;
  }

  function getPlayerResponse() {
    const expectedId = currentVideoId();
    const matches = response => expectedId && response?.videoDetails?.videoId === expectedId;

    const moviePlayer = document.querySelector("ytd-reel-video-renderer[is-active] #movie_player") || document.getElementById("movie_player");
    if (moviePlayer && typeof moviePlayer.getPlayerResponse === "function") {
      try {
        const response = moviePlayer.getPlayerResponse();
        if (matches(response)) return response;
      } catch {
        // Player may not be initialized yet.
      }
    }

    const direct = window.ytInitialPlayerResponse;
    if (matches(direct)) return direct;

    const raw = window.ytplayer?.config?.args?.player_response;
    if (typeof raw === "string") {
      try {
        const response = JSON.parse(raw);
        if (matches(response)) return response;
      } catch {
        // Ignore malformed player data.
      }
    }

    return null;
  }

  function extractContext() {
    const response = getPlayerResponse();
    const details = response?.videoDetails || {};
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const videoId = details.videoId || currentVideoId();

    return {
      url: location.href,
      videoId,
      playerReady: Boolean(response?.videoDetails),
      hasTranscriptEndpoint: Boolean(transcriptEndpoint()),
      canFetchTranscript: Boolean(videoId && innerTubeContext()),
      title: details.title || document.title.replace(/\s*-\s*YouTube\s*$/, "") || null,
      channel: details.author || null,
      durationSeconds: Number(details.lengthSeconds || 0) || null,
      captionTracks: tracks.map(track => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        name: track.name?.simpleText || track.name?.runs?.map(run => run.text).join("") || track.languageCode,
        kind: track.kind || null,
        isTranslatable: Boolean(track.isTranslatable)
      }))
    };
  }

  function transcriptEndpoint() {
    const expectedId = currentVideoId();
    const sources = [document.querySelector("ytd-watch-flexy")?.data, document.querySelector("ytd-app")?.data?.response, window.ytInitialData];
    for (const data of sources) {
      if (!expectedId || data?.currentVideoEndpoint?.watchEndpoint?.videoId !== expectedId) continue;
      // Transcript commands can live in the description/timeline, not just engagementPanels.
      const pending = [data], seen = new Set();
      while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        if (typeof value.getTranscriptEndpoint?.params === "string") return value.getTranscriptEndpoint;
        pending.push(...Object.values(value).filter(item => item && typeof item === "object"));
      }
    }
    return null;
  }

  function parseTranscriptResponse(data, tracks = extractContext().captionTracks) {
    const segments = [];
    const pending = [data];
    let language = "";
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      const segment = value.transcriptSegmentRenderer || value.transcriptSegmentViewModel || value.transcriptCueRenderer;
      if (segment) {
        const startMs = segment.startMs ?? segment.startTimeMs ?? segment.startOffsetMs;
        // PAmodern timeline rows use simpleText + timestamp, without startMs.
        const timestamp = String(segment.timestamp || "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
        const startSeconds = startMs != null ? Number(startMs) / 1000 : timestamp
          ? Number(timestamp[1] || 0) * 3600 + Number(timestamp[2]) * 60 + Number(timestamp[3]) : NaN;
        const endSeconds = Number(segment.endMs) / 1000;
        const textValue = segment.snippet || segment.text || segment.cue;
        const text = String(segment.simpleText || textValue?.content || textValue?.simpleText || textValue?.runs?.map(run => run.text || "").join("") || "")
          .replace(/\s+/g, " ").trim();
        if (Number.isFinite(startSeconds) && startSeconds >= 0 && text) {
          segments.push({startSeconds, durationSeconds: Number.isFinite(endSeconds) ? Math.max(0, endSeconds - startSeconds) : 0, text});
        }
        continue;
      }
      const selected = value.sortFilterSubMenuRenderer?.subMenuItems?.find(item => item.selected);
      if (selected?.title) language = selected.title;
      pending.push(...Object.values(value).filter(item => item && typeof item === "object"));
    }
    if (!segments.length) return null;
    segments.sort((a, b) => a.startSeconds - b.startSeconds);
    for (let index = 0; index < segments.length - 1; index++) {
      if (!segments[index].durationSeconds) segments[index].durationSeconds = Math.max(0, segments[index + 1].startSeconds - segments[index].startSeconds);
    }
    const track = tracks.find(item => language && item.name.toLocaleLowerCase() === language.toLocaleLowerCase());
    return {source: "youtube_transcript_api", language: language || "Language unavailable",
      languageCode: track?.languageCode || "unknown", isGenerated: track ? track.kind === "asr" : null, segments};
  }

  function innerTubeContext() {
    return window.ytcfg?.get?.("INNERTUBE_CONTEXT") || window.ytcfg?.data_?.INNERTUBE_CONTEXT;
  }

  function modernTranscriptParams(videoId) {
    // PAmodern transcript protobuf: field 149 holds {video_id: field 1, mode: 2}.
    const bytes = [0xaa, 0x09, 0x0f, 0x0a, 0x0b, ...[...videoId].map(char => char.charCodeAt(0)), 0x18, 0x02];
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function transcriptHeaders() {
    const headers = {"Content-Type": "application/json"};
    // Match the page's signed-in session without exporting cookies to the extension.
    const cookie = String(document.cookie || "").split(";").map(value => value.trim())
      .find(value => value.startsWith("SAPISID=")) || String(document.cookie || "").split(";").map(value => value.trim())
      .find(value => value.startsWith("__Secure-3PAPISID="));
    if (cookie) {
      const timestamp = Math.floor(Date.now() / 1000);
      const input = new TextEncoder().encode(`${timestamp} ${cookie.slice(cookie.indexOf("=") + 1)} ${location.origin}`);
      const hash = await crypto.subtle.digest("SHA-1", input);
      headers.Authorization = `SAPISIDHASH ${timestamp}_${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
      headers["X-Goog-AuthUser"] = String(window.ytcfg?.get?.("SESSION_INDEX") || "0");
    }
    return headers;
  }

  const transcriptRequests = new Map();
  async function readTranscript(message, byId = false) {
    const requestId = message.requestId;
    if (typeof requestId !== "string" || requestId.length > 100 || transcriptRequests.has(requestId)) return;
    const videoId = message.expectedVideoId;
    const context = innerTubeContext();
    if (!/^[\w-]{11}$/.test(videoId || "") || (!byId && videoId !== currentVideoId()) || !context) {
      window.postMessage({source: SOURCE, type: "TRANSCRIPT_RESULT", requestId, videoId: message.expectedVideoId, transcript: null}, "*");
      return;
    }
    const controller = new AbortController();
    transcriptRequests.set(requestId, controller);
    const timer = setTimeout(() => controller.abort(), 6000);
    let transcript = null;
    try {
      const headers = await transcriptHeaders();
      // A thumbnail request belongs to its explicit ID, never the feed/watch page's data.
      const endpoint = byId ? null : transcriptEndpoint();
      const requests = [{url: "/youtubei/v1/get_panel", body: {context, panelId: "PAmodern_transcript_view", params: modernTranscriptParams(videoId)}}];
      if (endpoint) requests.push({url: "/youtubei/v1/get_transcript", body: {context, params: endpoint.params}});
      for (const request of requests) {
        if (controller.signal.aborted || (!byId && currentVideoId() !== videoId)) break;
        const attempt = new AbortController();
        const cancel = () => attempt.abort();
        controller.signal.addEventListener("abort", cancel, {once: true});
        const attemptTimer = setTimeout(cancel, 2800);
        try {
          const response = await fetch(request.url, {
            method: "POST", credentials: "include", signal: attempt.signal,
            headers, body: JSON.stringify(request.body)
          });
          const candidate = response.ok ? parseTranscriptResponse(await response.json(), byId ? [] : extractContext().captionTracks) : null;
          const captionLanguage = message.captionLanguage || "auto";
          if (candidate && (captionLanguage === "auto" || (candidate.isGenerated !== null
            && `${candidate.languageCode}:${candidate.isGenerated ? "asr" : "manual"}` === captionLanguage))) {
            transcript = candidate;
            break;
          }
        } catch { /* Try the legacy endpoint when the modern panel fails. */ }
        finally {
          clearTimeout(attemptTimer);
          controller.signal.removeEventListener("abort", cancel);
        }
      }
      if ((!byId && currentVideoId() !== videoId) || controller.signal.aborted) transcript = null;
    } catch {
      // YouTube can reject this endpoint too; the rendered panel remains a fallback.
    } finally {
      clearTimeout(timer);
      transcriptRequests.delete(requestId);
      window.postMessage({source: SOURCE, type: "TRANSCRIPT_RESULT", requestId, videoId: message.expectedVideoId, transcript}, "*");
    }
  }

  function publish() {
    window.postMessage({
      source: SOURCE,
      type: "VIDEO_CONTEXT",
      payload: extractContext()
    }, "*");
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    if (event.data?.source !== "video-preview-content-script") return;
    if (event.data?.type === "REQUEST_VIDEO_CONTEXT") publish();
    if (event.data?.type === "REQUEST_TRANSCRIPT") void readTranscript(event.data);
    if (event.data?.type === "REQUEST_TRANSCRIPT_BY_ID") void readTranscript(event.data, true);
    if (event.data?.type === "CANCEL_TRANSCRIPT_REQUEST") transcriptRequests.get(event.data.requestId)?.abort();
  });

  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(publish, 250);
    setTimeout(publish, 1200);
  });

  setTimeout(publish, 300);
  setTimeout(publish, 1500);
})();
