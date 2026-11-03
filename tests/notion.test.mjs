import test from "node:test";
import assert from "node:assert/strict";
import {notionPageId, notionBlocks, createNotionPage, checkNotion} from "../extension/notion.js";
import {videoUrl} from "../extension/shared.js";
import {summary, VIDEO_A} from "./helpers.mjs";

const PAGE = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const DASHED = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";

function fakeFetch(responses = []) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({url, ...options, body: options.body && JSON.parse(options.body)});
    const [status, data] = responses.shift() || [200, {id: "new-page"}];
    return {ok: status < 300, status, json: async () => data};
  };
  return {calls, impl};
}

test("page IDs come from links, bare IDs, or UUIDs", () => {
  assert.equal(notionPageId(`https://www.notion.so/team/Reading-list-${PAGE}?pvs=4`), DASHED);
  assert.equal(notionPageId(PAGE.toUpperCase()), DASHED);
  assert.equal(notionPageId(DASHED), DASHED);
  assert.equal(notionPageId("https://www.notion.so/team/Reading-list"), null);
});

test("summaries become native blocks with timestamp links and Markdown structure", () => {
  const record = summary(VIDEO_A, {durationSeconds: 754});
  record.preview = {...record.preview, topics: ["Bread"], format: "follow_along",
    full_summary: "## Steps\n1. **Mix** the dough\n   - Rest *10 minutes*\n\n::: spoiler Ending\nIt rises.\n:::\n\n| A | B |\n|---|---|\n| 1 | 2 |"};
  const blocks = notionBlocks(record);
  assert.deepEqual(blocks.map(block => block.type),
    ["video", "paragraph", "quote", "paragraph", "heading_2", "bulleted_list_item", "heading_2", "numbered_list_item", "toggle", "table", "heading_2", "bulleted_list_item"]);
  assert.equal(blocks[0].video.external.url, videoUrl(VIDEO_A));
  const takeaway = blocks[5].bulleted_list_item.rich_text;
  assert.equal(takeaway[0].text.link.url, videoUrl(VIDEO_A, 42));
  const step = blocks[7].numbered_list_item;
  assert.deepEqual(step.rich_text.map(part => [part.text.content, part.annotations.bold]), [["Mix", true], [" the dough", false]]);
  assert.equal(step.children[0].bulleted_list_item.rich_text[1].annotations.italic, true);
  assert.equal(blocks[8].toggle.children[0].paragraph.rich_text[0].text.content, "It rises.");
  assert.equal(blocks[9].table.children.length, 2);
});

test("long text is split under Notion's 2,000-character limit", () => {
  const record = summary(); record.preview.one_sentence_summary = "x".repeat(4500);
  const quote = notionBlocks(record).find(block => block.type === "quote").quote.rich_text;
  assert.deepEqual(quote.map(part => part.text.content.length), [2000, 2000, 500]);
});

test("pages are created under the chosen parent, in batches of 100 blocks", async () => {
  const record = summary(); record.preview.key_takeaways = Array.from({length: 150}, (_, i) => ({text: `Point ${i}`, timestamp_seconds: i}));
  const f = fakeFetch([[200, {id: "new-page"}]]);
  await createNotionPage({token: " ntn_secret ", parent: PAGE}, record, f.impl);
  assert.equal(f.calls[0].url, "https://api.notion.com/v1/pages");
  assert.equal(f.calls[0].headers.Authorization, "Bearer ntn_secret");
  assert.equal(f.calls[0].body.parent.page_id, DASHED);
  assert.equal(f.calls[0].body.properties.title.title[0].text.content, record.title);
  assert.equal(f.calls[0].body.children.length, 100);
  assert.equal(f.calls[1].url, "https://api.notion.com/v1/blocks/new-page/children");
  assert.equal(f.calls[1].method, "PATCH");
  assert.equal(f.calls.length, 2);
});

test("Notion errors explain the fix, and missing setup never makes a request", async () => {
  const f = fakeFetch();
  await assert.rejects(createNotionPage({token: "", parent: PAGE}, summary(), f.impl), /Set up Notion in Settings/);
  assert.equal(f.calls.length, 0);
  for (const [status, pattern] of [[401, /integration secret/], [404, /Connections/], [403, /Insert content/], [429, /busy/], [400, /couldn’t save the page: bad body/]]) {
    await assert.rejects(checkNotion({token: "t", parent: PAGE}, fakeFetch([[status, {message: "bad body"}]]).impl), pattern);
  }
  assert.match(await checkNotion({token: "t", parent: PAGE}, fakeFetch([[200, {}]]).impl), /Connected/);
});
