import test from "node:test";
import assert from "node:assert/strict";
import {renderObsidianNote, obsidianFolder, obsidianNewNoteUri, noteVariables} from "../extension/obsidian.js";
import {videoUrl} from "../extension/shared.js";
import {summary, VIDEO_A} from "./helpers.mjs";

test("Obsidian notes carry YAML properties, an embed, and timestamped takeaways", async () => {
  const note = await renderObsidianNote(summary(VIDEO_A, {title: 'Bake: "bread" #1', durationSeconds: 754,
    preview: {...summary().preview, key_takeaways: [{text: "Use [warm] water", timestamp_seconds: 42}, {text: "Untimed", timestamp_seconds: null}], classification: {categoryName: "Cooking & Food"}}}));
  assert.match(note.content, /^---\ntitle: "Bake: \\"bread\\" #1"\nsource: "https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk"\nchannel: "Test channel"\n/);
  assert.match(note.content, /duration: "12:34"\ncategory: "Cooking & Food"\ncreated: "2026-10-0[12]"\n/);
  assert.match(note.content, /tags:\n {2}- "clipse"\n {2}- "youtube"\n {2}- "cooking-food"\n---\n/);
  assert.ok(note.content.includes(`![](${videoUrl(VIDEO_A)})`));
  assert.ok(note.content.includes(`- [00:42](${videoUrl(VIDEO_A, 42)}) Use \\[warm\\] water\n- Untimed\n`));
  assert.ok(note.content.includes("## Summary\n\nA complete summary."));
  assert.ok(note.content.includes("## What you'll learn\n\n- An outcome\n"));
  assert.doesNotMatch(note.content, /\n{3}/);
  assert.equal(note.name, "Bake bread 1");
});

test("Obsidian notes omit empty sections and fall back to a usable file name", async () => {
  const note = await renderObsidianNote({videoId: VIDEO_A, createdAt: "2026-10-01T12:00:00Z", preview: {one_sentence_summary: "Only this."}});
  assert.doesNotMatch(note.content, /channel:|duration:|category:|## /);
  assert.equal(note.name, "YouTube video");
  assert.deepEqual(noteVariables({videoId: VIDEO_A, preview: {one_sentence_summary: ""}}).tags, ["clipse", "youtube"]);
});

test("Obsidian URIs stay short, encoded, and inside the vault", () => {
  assert.equal(obsidianFolder(" /Sources\\..\\YouTube/./ "), "Sources/YouTube");
  assert.equal(obsidianFolder(""), "");
  assert.equal(obsidianNewNoteUri({vault: "My Vault", folder: "Clipse", name: "A & B"}), "obsidian://new?vault=My%20Vault&file=Clipse%2FA%20%26%20B&clipboard=true");
  assert.equal(obsidianNewNoteUri({vault: " ", folder: "", name: "Note"}), "obsidian://new?file=Note&clipboard=true");
});
