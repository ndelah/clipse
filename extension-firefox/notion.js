import {videoUrl, timestamp, summaryParagraphs} from "./shared.js";
import {parseMarkdown, parseInline} from "./markdown.js";

// Notion's public API with the user's own internal integration: free, keyless for Clipse, and the only way to
// create a page with content (there is no URI scheme for it). Host access is optional and requested on first use.
export const NOTION_ORIGIN = "https://api.notion.com/*";
export const NOTION_INTEGRATIONS_URL = "https://www.notion.so/profile/integrations";
export const NOTION_CONNECTIONS_HELP = "https://www.notion.com/help/add-and-manage-connections-with-the-api";
const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";
const TEXT_LIMIT = 2000, CHILD_LIMIT = 100;

// Must run inside the click itself: Chrome only shows the permission prompt during a user gesture.
// Resolves true at once, without a prompt, when access was already granted.
export function requestNotionAccess() {
  return globalThis.chrome?.permissions?.request ? chrome.permissions.request({origins: [NOTION_ORIGIN]}) : Promise.resolve(true);
}

// Accepts a page link (…/Page-title-<32 hex>?pvs=4), a bare ID, or a dashed UUID.
export function notionPageId(value) {
  const hex = String(value || "").replace(/-/g, "").match(/[0-9a-f]{32}(?![0-9a-f])/gi)?.at(-1);
  return hex ? hex.toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") : null;
}

function richText(text, {link, bold = false, italic = false, code = false} = {}) {
  const value = String(text || "");
  const parts = [];
  for (let i = 0; i < value.length; i += TEXT_LIMIT) parts.push(value.slice(i, i + TEXT_LIMIT));
  return parts.map(content => ({type: "text", text: {content, ...(link ? {link: {url: link}} : {})}, annotations: {bold, italic, code}}));
}
function inlineText(text) {
  const walk = (nodes, marks) => nodes.flatMap(node => node.type === "text" ? richText(node.text, marks)
    : node.type === "code" ? richText(node.text, {...marks, code: true})
    : walk(node.children, {...marks, [node.type === "strong" ? "bold" : "italic"]: true}));
  return walk(parseInline(String(text || "")), {});
}
const block = (type, value) => ({object: "block", type, [type]: value});
const paragraph = rich => block("paragraph", {rich_text: rich});

// One create request may nest two levels deep; anything deeper is flattened into the deepest allowed level.
function toBlocks(nodes, depth = 0) {
  const nested = children => depth >= 1 ? {} : children.length ? {children: toBlocks(children, depth + 1)} : {};
  const flat = children => depth >= 1 ? toBlocks(children, depth) : [];
  return nodes.flatMap(node => {
    switch (node.type) {
      case "heading": return [block(node.level <= 2 ? "heading_2" : "heading_3", {rich_text: inlineText(node.text)})];
      case "paragraph": return [paragraph(inlineText(node.text))];
      case "rule": return [block("divider", {})];
      case "code": return [block("code", {rich_text: richText(node.text), language: "plain text"})];
      case "quote": {
        const [first, ...rest] = node.children;
        return [block("quote", {rich_text: first?.type === "paragraph" ? inlineText(first.text) : [], ...nested(first?.type === "paragraph" ? rest : node.children)}), ...flat(rest)];
      }
      case "spoiler": return [block("toggle", {rich_text: inlineText(node.label), ...(depth >= 1 ? {} : {children: toBlocks(node.children, depth + 1)})}), ...flat(node.children)];
      case "table": return [block("table", {table_width: node.header.length, has_column_header: true, has_row_header: false,
        children: [node.header, ...node.rows].map(row => block("table_row", {cells: node.header.map((_, i) => inlineText(row[i] || ""))}))})];
      case "list": return node.items.flatMap(item => {
        const [first, ...rest] = item.children;
        const head = first?.type === "paragraph" ? inlineText(first.text) : [];
        const children = first?.type === "paragraph" ? rest : item.children;
        const type = item.checked !== null ? "to_do" : node.ordered ? "numbered_list_item" : "bulleted_list_item";
        return [block(type, {rich_text: head, ...(type === "to_do" ? {checked: item.checked} : {}), ...nested(children)}), ...flat(children)];
      });
      default: return [];
    }
  });
}

// The same content as the Markdown export, as native Notion blocks.
export function notionBlocks(summary) {
  const p = summary.preview || {};
  const blocks = [block("video", {type: "external", external: {url: videoUrl(summary.videoId)}})];
  const context = [summary.channel, Number.isFinite(summary.durationSeconds) && summary.durationSeconds > 0 ? timestamp(summary.durationSeconds) : ""].filter(Boolean).join(" · ");
  blocks.push(paragraph([...richText(context ? `${context} · ` : ""), ...richText("Watch on YouTube", {link: videoUrl(summary.videoId)})].filter(item => item.text.content)));
  if (p.one_sentence_summary) blocks.push(block("quote", {rich_text: richText(p.one_sentence_summary)}));
  if (p.topics?.length) blocks.push(paragraph(richText(p.topics.join(" · "), {italic: true})));
  if (p.key_takeaways?.length) {
    blocks.push(block("heading_2", {rich_text: richText("Key takeaways")}));
    for (const item of p.key_takeaways) {
      const stamp = Number.isFinite(item.timestamp_seconds) ? [...richText(timestamp(item.timestamp_seconds), {link: videoUrl(summary.videoId, item.timestamp_seconds)}), ...richText(" ")] : [];
      blocks.push(block("bulleted_list_item", {rich_text: [...stamp, ...richText(item.text)]}));
    }
  }
  if (p.full_summary && p.format) blocks.push(...toBlocks(parseMarkdown(p.full_summary)));
  else if (p.full_summary) blocks.push(block("heading_2", {rich_text: richText("Summary")}), ...summaryParagraphs(p.full_summary).map(text => paragraph(richText(text))));
  if (p.learning_outcomes?.length) {
    blocks.push(block("heading_2", {rich_text: richText("What you'll learn")}));
    for (const outcome of p.learning_outcomes) blocks.push(block("bulleted_list_item", {rich_text: richText(outcome)}));
  }
  return blocks;
}

async function request(path, token, {method = "GET", body, fetchImpl = fetch} = {}) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {method, headers: {Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json"},
      ...(body ? {body: JSON.stringify(body)} : {})});
  } catch { throw new Error("Couldn’t reach Notion. Check your connection and try again."); }
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (response.status === 401) throw new Error("Notion didn’t accept the integration secret. Copy it again from your Notion integration and save Settings.");
  if (response.status === 404) throw new Error("Notion can’t see that page. Open it in Notion, choose ••• → Connections, and add your Clipse integration.");
  if (response.status === 403) throw new Error("The integration can’t add content. In your Notion integration’s capabilities, turn on Insert content.");
  if (response.status === 429) throw new Error("Notion is busy. Wait a few seconds and try again.");
  throw new Error(`Notion couldn’t save the page${data.message ? `: ${data.message}` : "."}`);
}

function credentials({token, parent}) {
  const pageId = notionPageId(parent);
  if (!String(token || "").trim() || !pageId) throw new Error("Set up Notion in Settings: add your integration secret and the page summaries should go under.");
  return {token: String(token).trim(), pageId};
}

// Confirms the secret works and the page is shared with the integration, without writing anything.
export async function checkNotion(settings, fetchImpl) {
  const {token, pageId} = credentials(settings);
  await request(`/pages/${pageId}`, token, {fetchImpl});
  return "Connected. Summaries will be saved as pages under that Notion page.";
}

export async function createNotionPage(settings, summary, fetchImpl) {
  const {token, pageId} = credentials(settings);
  const blocks = notionBlocks(summary);
  const page = await request("/pages", token, {method: "POST", fetchImpl, body: {parent: {page_id: pageId},
    properties: {title: {title: richText((summary.title || "YouTube video").slice(0, TEXT_LIMIT))}}, children: blocks.slice(0, CHILD_LIMIT)}});
  for (let i = CHILD_LIMIT; i < blocks.length; i += CHILD_LIMIT) {
    await request(`/blocks/${page.id}/children`, token, {method: "PATCH", fetchImpl, body: {children: blocks.slice(i, i + CHILD_LIMIT)}});
  }
  return page;
}
