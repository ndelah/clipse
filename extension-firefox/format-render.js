import {createEngine, standardFilters} from "./vendor/knap.js";
import {SUMMARY_FORMATS, FALLBACK_FORMAT} from "./formats.js";

// Kept apart from formats.js so only the summarizer loads Knap; settings pages need just the format list.
const line = value => String(value ?? "").replace(/\s+/g, " ").trim();
const engine = createEngine({filters: {...standardFilters,
  line,
  // Table cells cannot hold pipes or line breaks; an empty cell still needs a mark so the column reads as deliberate.
  cell: value => line(value).replace(/\|/g, "\\|") || "—",
  // Inline conditionals would lose their spacing (Knap trims whitespace beside tags), so optional text joins through filters.
  prefix: (value, _param, context) => line(value) ? `${context?.rawArguments?.[0] ?? ""}${line(value)}` : "",
  suffix: (value, _param, context) => line(value) ? `${line(value)}${context?.rawArguments?.[0] ?? ""}` : "",
  label: value => line(value) ? `**${line(value)}:** ` : "",
  facts: (_value, _param, context) => (Array.isArray(context?.rawValue) ? context.rawValue : [])
    .filter(fact => line(fact?.label) && line(fact?.value)).map(fact => `**${line(fact.label)}:** ${line(fact.value)}`).join(" · ")
}});

export async function renderFormat(formatId, fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const format = SUMMARY_FORMATS[formatId] || SUMMARY_FORMATS[FALLBACK_FORMAT];
  const markdown = await engine.renderOrThrow(format.template, {variables: fields});
  return markdown.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
