import {createEngine, standardFilters} from "./vendor/knap.js";
import {DEFAULT_SETTINGS, videoUrl, timestamp, summaryParagraphs} from "./shared.js";
import {exportableMarkdown} from "./markdown.js";

// Knap is the template language behind Obsidian Web Clipper. Data stays raw here; the template owns all Markdown and YAML formatting.
export const DEFAULT_NOTE_TEMPLATE = `---
{{ title | yaml_property:"title" }}
{{ url | yaml_property:"source" }}
{% if channel %}
{{ channel | yaml_property:"channel" }}
{% endif %}
{{ video_id | yaml_property:"video_id" }}
{% if duration %}
{{ duration | yaml_property:"duration" }}
{% endif %}
{% if category %}
{{ category | yaml_property:"category" }}
{% endif %}
{{ created | date:"YYYY-MM-DD" | yaml_property:"created" }}
{{ description | yaml_property:"description" }}
{{ tags | yaml_property:"tags" }}
---
![]({{ url }})

{{ description | escape_md }}
{% if takeaways %}

## Key takeaways

{% for item in takeaways %}
- {% if item.url %}[{{ item.time }}]({{ item.url }}) {% endif %}{{ item.text | escape_md }}
{% endfor %}
{% endif %}
{% if full_summary %}

{{ full_summary }}
{% endif %}
{% if outcomes %}

## What you'll learn

{% for outcome in outcomes %}
- {{ outcome | escape_md }}
{% endfor %}
{% endif %}
`;

const engine = createEngine({filters: standardFilters});

function tagSlug(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}_/-]+/gu, "-").replace(/^-+|-+$/g, "");
}

// Everything a note template may use. Keep names stable: user templates will depend on them.
export function noteVariables(summary) {
  const p = summary.preview || {};
  const category = p.classification?.categoryName || "";
  const fullSummary = !p.full_summary ? ""
    : p.format ? exportableMarkdown(p.full_summary).trim()
    : ["## Summary", "", summaryParagraphs(p.full_summary).join("\n\n")].join("\n");
  return {
    title: summary.title || "YouTube video", url: videoUrl(summary.videoId), video_id: summary.videoId, channel: summary.channel || "",
    duration: Number.isFinite(summary.durationSeconds) && summary.durationSeconds > 0 ? timestamp(summary.durationSeconds) : "",
    category, format: p.format || "", language: summary.transcriptLanguage || "",
    created: summary.createdAt || new Date().toISOString(), updated: summary.updatedAt || summary.createdAt || new Date().toISOString(),
    description: p.one_sentence_summary || "",
    takeaways: (p.key_takeaways || []).map(item => {
      const seconds = Number.isFinite(item.timestamp_seconds) ? item.timestamp_seconds : null;
      return {text: item.text, seconds, time: seconds == null ? "" : timestamp(seconds), url: seconds == null ? "" : videoUrl(summary.videoId, seconds)};
    }),
    full_summary: fullSummary, outcomes: p.learning_outcomes || [],
    topics: p.topics || [],
    tags: [...new Set(["clipse", "youtube", tagSlug(category), ...(p.topics || []).map(tagSlug)].filter(Boolean))]
  };
}

export async function renderObsidianNote(summary, template = DEFAULT_NOTE_TEMPLATE) {
  const variables = noteVariables(summary);
  const [note, name] = await Promise.all([engine.renderOrThrow(template, {variables}), engine.renderOrThrow("{{ title | safe_name }}", {variables})]);
  return {content: note.replace(/\n{3,}/g, "\n\n").trim() + "\n", name: name.trim().slice(0, 120) || `Clipse ${summary.videoId}`};
}

export function obsidianFolder(value) {
  return String(value ?? DEFAULT_SETTINGS.obsidianFolder).split(/[\\/]+/).map(part => part.trim()).filter(part => part && part !== "." && part !== "..").join("/");
}

// The note travels through the clipboard: a Markdown note in the URI itself would be percent-encoded and can exceed OS limits.
export function obsidianNewNoteUri({vault = "", folder = DEFAULT_SETTINGS.obsidianFolder, name}) {
  const file = [obsidianFolder(folder), name].filter(Boolean).join("/");
  const params = [["vault", String(vault).trim()], ["file", file], ["clipboard", "true"]].filter(([, value]) => value);
  return `obsidian://new?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}
