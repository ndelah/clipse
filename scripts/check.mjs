import assert from "node:assert/strict";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extension = path.join(root, "extension");
const firefoxExtension = path.join(root, "extension-firefox");
const manifest = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));
const firefoxManifest = JSON.parse(readFileSync(path.join(firefoxExtension, "manifest.json"), "utf8"));
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

assert.equal(firefoxManifest.manifest_version, 3, "Expected a Firefox Manifest V3 extension");
assert.equal(firefoxManifest.name, "Clipse");
assert.equal(firefoxManifest.version, pkg.version, "Package and Firefox extension versions must match");
assert.equal(firefoxManifest.version, manifest.version, "Chrome and Firefox extension versions must match");
assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "clipse@clipse.extension");
assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, "128.0");
assert.deepEqual(firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required, ["websiteContent"]);
assert.deepEqual(firefoxManifest.background, {scripts: ["service-worker.js"], type: "module"});
assert.equal(firefoxManifest.background.service_worker, undefined);
assert.equal(firefoxManifest.sidebar_action.default_panel, "sidepanel.html");
assert.equal(firefoxManifest.sidebar_action.open_at_install, false);
assert.equal(firefoxManifest.options_ui.page, "options.html");
assert.equal(firefoxManifest.options_ui.open_in_tab, true);
assert.equal(firefoxManifest.side_panel, undefined);
assert.equal(firefoxManifest.minimum_chrome_version, undefined);
for (const permission of ["offscreen", "sidePanel", "clipboardWrite"]) {
  assert.equal(firefoxManifest.permissions.includes(permission), false, `Firefox manifest must not request ${permission}`);
}
assert.ok(firefoxManifest.content_scripts.some(script => script.world === "MAIN"), "Firefox still needs a MAIN-world page script");

/**
 * @param {string} directory
 * @param {string} [base]
 * @returns {string[]}
 */
function relativeFiles(directory, base = directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) files.push(...relativeFiles(absolute, base));
    else files.push(path.relative(base, absolute));
  }
  return files.sort();
}

const chromeFiles = relativeFiles(extension).filter(relative => relative !== "manifest.json");
const firefoxFiles = relativeFiles(firefoxExtension).filter(relative => relative !== "manifest.json");
assert.deepEqual(firefoxFiles, chromeFiles, "Run npm run sync:firefox so shared extension files match");
for (const relative of chromeFiles) {
  const chromeBytes = readFileSync(path.join(extension, relative));
  const firefoxBytes = readFileSync(path.join(firefoxExtension, relative));
  assert.equal(Buffer.compare(chromeBytes, firefoxBytes), 0, `Firefox copy drifted: ${relative}. Run npm run sync:firefox.`);
}

console.log(`Clipse ${manifest.version}: manifest, local entrypoints, ${checked} JavaScript files, and Firefox parity checked.`);
