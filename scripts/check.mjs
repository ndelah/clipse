import assert from "node:assert/strict";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extension = path.join(root, "extension");
const manifest = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(manifest.manifest_version, 3, "Expected a Manifest V3 extension");
assert.equal(manifest.name, "Clipse");
assert.equal(manifest.version, pkg.version, "Package and extension versions must match");

const entrypoints = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.options_page,
  ...manifest.content_scripts.flatMap(script => script.js),
  ...manifest.content_scripts.flatMap(script => script.css || []),
  ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action.default_icon || {}),
  "offscreen.html"
];
for (const relative of entrypoints) {
  assert.ok(existsSync(path.join(extension, relative)), `Missing extension file: ${relative}`);
}

let checked = 0;
for (const filename of readdirSync(extension)) {
  if (filename.endsWith(".js")) {
    const source = readFileSync(path.join(extension, filename), "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      assert.ok(existsSync(path.join(extension, match[1])), `Missing JavaScript import: ${filename} → ${match[1]}`);
    }
    const result = spawnSync(process.execPath, ["--check", path.join(extension, filename)], {stdio: "inherit"});
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Syntax check failed: ${filename}`);
    checked += 1;
  }
  if (filename.endsWith(".html")) {
    const html = readFileSync(path.join(extension, filename), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const relative = match[1];
      if (/^(?:https?:|data:)/.test(relative)) continue;
      assert.ok(existsSync(path.join(extension, relative)), `Missing HTML resource: ${filename} → ${relative}`);
    }
  }
}
assert.ok(existsSync(path.join(root, "assets/brand/eclipse.svg")), "Missing supplied logo");
console.log(`Clipse ${manifest.version}: manifest, local entrypoints, and ${checked} JavaScript files checked.`);
