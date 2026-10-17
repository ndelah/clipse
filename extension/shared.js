import {DEFAULT_CATEGORIES, normalizeCategories, upgradeStarterCategories} from "./categories.js";

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "", model: "gpt-4.1-mini", outputLanguage: "same", captionLanguage: "auto", summaryLength: "detailed",
  categories: DEFAULT_CATEGORIES, routingVersion: 2
});
export const HISTORY_FORMAT = "video-preview-history";
export const HISTORY_VERSION = 1;

export async function loadSettings(storage) {
  const settings = await storage.get({...DEFAULT_SETTINGS, classifierProvider: null, jevApiKey: null});
  if (settings.classifierProvider !== null || settings.jevApiKey !== null || settings.routingVersion !== 2) {
    await storage.remove(["classifierProvider", "jevApiKey"]);
    await storage.set({routingVersion: 2});
    settings.routingVersion = 2;
  }
  delete settings.classifierProvider;
  delete settings.jevApiKey;
  const categories = upgradeStarterCategories(settings.categories);
  if (categories !== settings.categories) {
    await storage.set({categories});
    settings.categories = categories;
  }
  return settings;
}

export function summaryConfiguration(settings = {}) {
  return {
    model: String(settings.model || DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model,
    outputLanguage: String(settings.outputLanguage || DEFAULT_SETTINGS.outputLanguage).trim().slice(0, 80) || DEFAULT_SETTINGS.outputLanguage,
    captionLanguage: String(settings.captionLanguage || "auto").slice(0, 80),
    summaryLength: settings.summaryLength === "brief" ? "brief" : "detailed",
    categories: normalizeCategories(settings.categories),
    routingVersion: [0, 1].includes(settings.routingVersion) ? settings.routingVersion : 2
  };
}

export function sameConfiguration(a, b) {
  const first = summaryConfiguration(a);
  const second = summaryConfiguration(b);
  return first.model === second.model && first.outputLanguage.toLowerCase() === second.outputLanguage.toLowerCase()
    && first.captionLanguage === second.captionLanguage && first.summaryLength === second.summaryLength
    && (a?.routingVersion ?? 0) === (b?.routingVersion ?? 0)
    && JSON.stringify(first.categories) === JSON.stringify(second.categories);
}

export function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    let id;
    if (url.hostname === "youtu.be") id = url.pathname.split("/")[1];
    else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}

export function videoUrl(videoId, seconds) {
  if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("Invalid YouTube video ID.");
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  if (Number.isFinite(seconds) && seconds >= 0) url.searchParams.set("t", `${Math.floor(seconds)}s`);
  return url.href;
}

export function timestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(total / 3600), Math.floor(total % 3600 / 60), total % 60];
  if (!parts[0]) parts.shift();
  return parts.map(value => String(value).padStart(2, "0")).join(":");
}

// Pick only public summary fields: imported extras must never become credentials or executable links.
export function normalizeSummary(value) {
  if (!value || typeof value !== "object" || typeof value.videoId !== "string" || !/^[\w-]{11}$/.test(value.videoId)
    || typeof value.url !== "string" || videoIdFromUrl(value.url) !== value.videoId) return null;
  const preview = value.preview;
  if (!preview || typeof preview !== "object" || typeof preview.one_sentence_summary !== "string") return null;
  const cleanPreview = {one_sentence_summary: preview.one_sentence_summary};
  for (const key of ["full_summary", "worth_watching", "content_type", "level", "useful_content_density"]) {
    if (preview[key] !== undefined && typeof preview[key] !== "string") return null;
    if (preview[key] !== undefined) cleanPreview[key] = preview[key];
  }
  if (preview.learning_outcomes !== undefined) {
    if (!Array.isArray(preview.learning_outcomes) || !preview.learning_outcomes.every(item => typeof item === "string")) return null;
    cleanPreview.learning_outcomes = preview.learning_outcomes;
  }
  if (preview.key_takeaways !== undefined) {
    if (!Array.isArray(preview.key_takeaways) || !preview.key_takeaways.every(item => item && typeof item.text === "string"
      && (item.timestamp_seconds == null || (Number.isInteger(item.timestamp_seconds) && item.timestamp_seconds >= 0)))) return null;
    cleanPreview.key_takeaways = preview.key_takeaways.map(item => {
      const clean = {text: item.text, timestamp_seconds: item.timestamp_seconds ?? null};
      const source = item.source;
      if (source && /^S\d+$/.test(source.segmentId || "") && Number.isInteger(source.startSeconds) && source.startSeconds >= 0
        && source.startSeconds === clean.timestamp_seconds && typeof source.text === "string" && source.text.trim() && source.text.length <= 800) {
        clean.source = {segmentId: source.segmentId, startSeconds: source.startSeconds, text: source.text};
      }
      return clean;
    });
  }
  const createdAt = value.createdAt || value.updatedAt;
  const updatedAt = value.updatedAt || createdAt;
  if (![createdAt, updatedAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date)))) return null;
  const summary = {videoId: value.videoId, url: videoUrl(value.videoId), preview: cleanPreview, createdAt, updatedAt};
  for (const key of ["jobId", "title", "channel", "transcriptLanguage", "transcriptLanguageCode", "transcriptSource"]) {
    if (typeof value[key] === "string") summary[key] = value[key];
  }
  summary.durationSeconds = Number.isFinite(value.durationSeconds) && value.durationSeconds >= 0 ? value.durationSeconds : null;
  if (value.evidenceVersion === 1) summary.evidenceVersion = 1;
  summary.transcriptIsGenerated = typeof value.transcriptIsGenerated === "boolean" ? value.transcriptIsGenerated : null;
  if (value.configuration) summary.configuration = summaryConfiguration({...value.configuration, routingVersion: value.configuration.routingVersion ?? 0});
  if (preview.classification && typeof preview.classification === "object") {
    const classification = preview.classification;
    const clean = {scores: {}};
    for (const key of ["categoryId", "categoryName", "provider", "model", "reason"]) {
      if (typeof classification[key] === "string") clean[key] = classification[key].slice(0, 100);
    }
    clean.sampled = classification.sampled === true;
    clean.confidence = Number.isFinite(classification.confidence) && classification.confidence >= 0 && classification.confidence <= 1 ? classification.confidence : null;
    for (const key of ["prior_knowledge", "content_density", "instruction_specificity"]) {
      const score = classification.scores?.[key];
      if (Number.isFinite(score?.score) && score.score >= 0 && score.score <= 2 && Number.isFinite(score.confidence) && score.confidence >= 0 && score.confidence <= 1) {
        clean.scores[key] = {score: score.score, confidence: score.confidence};
      }
    }
    cleanPreview.classification = clean;
  }
  return summary;
}

export function mergeSummaries(summaries, imported) {
  let added = 0, updated = 0;
  for (const summary of imported) {
    const existing = summaries[summary.videoId];
    if (!existing) { summaries[summary.videoId] = summary; added += 1; }
    else if (Date.parse(summary.updatedAt || summary.createdAt) > Date.parse(existing.updatedAt || existing.createdAt)) {
      summaries[summary.videoId] = summary;
      updated += 1;
    }
  }
  return {added, updated};
}

export function parseHistory(payload) {
  if (payload?.format !== HISTORY_FORMAT || payload?.version !== HISTORY_VERSION || !Array.isArray(payload.summaries)) {
    throw new Error("Choose a supported Clipse or Video Preview history file.");
  }
  const summaries = payload.summaries.map(normalizeSummary).filter(Boolean);
  if (!summaries.length && payload.summaries.length) throw new Error("The file contains no valid summaries.");
  return {summaries, skipped: payload.summaries.length - summaries.length};
}

export function summaryParagraphs(text) {
  const paragraphs = String(text || "").split(/\r?\n+/).map(part => part.trim()).filter(Boolean);
  if (paragraphs.length !== 1 || paragraphs[0].length <= 600) return paragraphs;
  // Older saved summaries may have no paragraph breaks. Keep sentences intact.
  const sentences = new Intl.Segmenter(undefined, {granularity: "sentence"}).segment(paragraphs[0]);
  const formatted = [];
  let paragraph = "";
  for (const {segment} of sentences) {
    if (paragraph && paragraph.length + segment.length > 500) {
      formatted.push(paragraph.trim()); paragraph = "";
    }
    paragraph += segment;
  }
  if (paragraph) formatted.push(paragraph.trim());
  return formatted;
}

function escapeMarkdown(text) {
  return String(text || "").replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, "\\$1");
}

export function summaryMarkdown(summary) {
  const p = summary.preview || {};
  const lines = [`# ${escapeMarkdown(summary.title || "YouTube video")}`, "", `[Watch on YouTube](${videoUrl(summary.videoId)})`, ""];
  if (summary.channel) lines.push(escapeMarkdown(summary.channel), "");
  lines.push(escapeMarkdown(p.one_sentence_summary), "", escapeMarkdown(p.worth_watching), "");
  if (p.key_takeaways?.length) {
    lines.push("## Key takeaways", "");
    for (const item of p.key_takeaways) {
      const link = Number.isFinite(item.timestamp_seconds) ? `[${timestamp(item.timestamp_seconds)}](${videoUrl(summary.videoId, item.timestamp_seconds)}) ` : "";
      lines.push(`- ${link}${escapeMarkdown(item.text)}`);
    }
    lines.push("");
  }
  if (p.full_summary) lines.push("## Summary", "", escapeMarkdown(summaryParagraphs(p.full_summary).join("\n\n")), "");
  if (p.learning_outcomes?.length) lines.push("## What you'll learn", "", ...p.learning_outcomes.map(value => `- ${escapeMarkdown(value)}`), "");
  return lines.join("\n").trim() + "\n";
}

