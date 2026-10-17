import test from "node:test";
import assert from "node:assert/strict";
import {sameConfiguration, summaryConfiguration, parseHistory, mergeSummaries, normalizeSummary, summaryMarkdown, summaryParagraphs, videoIdFromUrl, videoUrl, HISTORY_FORMAT} from "../extension/shared.js";
import {summary, VIDEO_A, VIDEO_B} from "./helpers.mjs";

test("cache compatibility includes generation preferences and invalidates pre-routing summaries", () => {
  assert.equal(sameConfiguration(undefined, summaryConfiguration()), false);
  assert.ok(sameConfiguration(summaryConfiguration(), summaryConfiguration()));
  for (const setting of [{model: "another-model"}, {outputLanguage: "French"}, {summaryLength: "brief"}]) assert.equal(sameConfiguration(undefined, setting), false);
  assert.ok(sameConfiguration({outputLanguage: " English "}, {outputLanguage: "english"}));
  assert.equal("apiKey" in summaryConfiguration({apiKey: "secret"}), false);
});

test("video identity is exact and rejects unrelated domains and malformed links", () => {
  assert.equal(videoIdFromUrl(`https://www.youtube.com/watch?v=${VIDEO_A}&t=42`), VIDEO_A);
  assert.equal(videoIdFromUrl(`https://youtu.be/${VIDEO_A}`), VIDEO_A);
  assert.equal(videoIdFromUrl(`https://www.youtube.com/shorts/${VIDEO_B}`), VIDEO_B);
  for (const url of [`https://evil.test/?v=${VIDEO_A}`, `javascript:alert(1)`, `https://www.youtube.com/@${VIDEO_A}`, `https://www.youtube.com/watch?v=${VIDEO_A}more`]) assert.equal(videoIdFromUrl(url), null);
});

test("old history imports remain portable while invalid records and private extras are excluded", () => {
  const imported = summary(VIDEO_A, {apiKey: "private", extra: "ignore", configuration: {apiKey: "secret", outputLanguage: "French"}});
  const invalidLink = summary(VIDEO_B, {url: "javascript:alert(1)"});
  const invalidPreview = summary(VIDEO_B, {preview: {one_sentence_summary: "Bad", key_takeaways: [{text: "Bad", timestamp_seconds: -1}]}});
  const parsed = parseHistory({format: HISTORY_FORMAT, version: 1, summaries: [imported, invalidLink, invalidPreview]});
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.summaries.length, 1);
  assert.equal("apiKey" in parsed.summaries[0], false);
  assert.equal("apiKey" in parsed.summaries[0].configuration, false);
  assert.equal(normalizeSummary(summary(VIDEO_A, {updatedAt: "invalid"})), null);
  assert.equal(normalizeSummary(summary(VIDEO_A, {videoId: null, url: "invalid"})), null);
  assert.throws(() => parseHistory({format: HISTORY_FORMAT, version: 2, summaries: []}));
});

test("merge and undo cannot replace a newer regenerated summary", () => {
  const latest = summary(VIDEO_A, {updatedAt: "2026-10-12T00:00:00Z"});
  const records = {[VIDEO_A]: latest};
  assert.deepEqual(mergeSummaries(records, [summary(), summary(VIDEO_B)]), {added: 1, updated: 0});
  assert.equal(records[VIDEO_A], latest);
});

test("Markdown export includes source and timestamp links and escapes source text", () => {
  const markdown = summaryMarkdown(summary(VIDEO_A, {title: "A [misleading](https://evil.test) title"}));
  assert.ok(markdown.includes(`[Watch on YouTube](${videoUrl(VIDEO_A)})`));
  assert.ok(markdown.includes(`[00:42](${videoUrl(VIDEO_A, 42)})`));
  assert.ok(markdown.includes("## What you'll learn"));
  assert.ok(markdown.includes("\\[misleading\\]"));
});

test("summary paragraphs preserve explicit breaks and reflow long saved blocks at sentence boundaries", () => {
  assert.deepEqual(summaryParagraphs(" First idea.\r\n\r\nSecond idea.\nThird idea. "), ["First idea.", "Second idea.", "Third idea."]);
  assert.deepEqual(summaryParagraphs("Short summary."), ["Short summary."]);
  assert.deepEqual(summaryParagraphs(null), []);
  const sentences = Array.from({length: 15}, (_, i) => `Topic ${i + 1} explains how a practical tool helps beginners understand and build electronic circuits.`);
  const text = sentences.join(" ");
  const paragraphs = summaryParagraphs(text);
  assert.ok(paragraphs.length > 1);
  assert.equal(paragraphs.join(" "), text);
  assert.ok(paragraphs.every(part => part.endsWith(".") && part.length <= 500));
  assert.deepEqual(summaryParagraphs(`${text}\n\nAn explicit final paragraph.`), [text, "An explicit final paragraph."]);
  const record = summary(); record.preview.full_summary = text;
  assert.ok(summaryMarkdown(record).includes(paragraphs.map(part => part.replaceAll(".", "\\.")).join("\n\n")));
  const unbroken = "A".repeat(700);
  assert.deepEqual(summaryParagraphs(unbroken), [unbroken]);
  const chinese = "这个工具帮助初学者理解电路原理并练习设计。".repeat(40);
  assert.equal(summaryParagraphs(chinese).join(""), chinese);
});
