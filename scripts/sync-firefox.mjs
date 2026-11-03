/**
 * Copy the Chrome extension into extension-firefox/, preserving the Firefox manifest.
 * Shared runtime files stay identical; Firefox-only behavior is feature-detected.
 */
import {cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "extension");
const destination = path.join(root, "extension-firefox");
const manifestPath = path.join(destination, "manifest.json");

if (!statSync(manifestPath, {throwIfNoEntry: false})?.isFile()) {
  throw new Error("extension-firefox/manifest.json is missing. Restore the Firefox manifest before syncing.");
}

const manifest = readFileSync(manifestPath);
rmSync(destination, {recursive: true, force: true});
mkdirSync(destination, {recursive: true});
cpSync(source, destination, {recursive: true});
writeFileSync(manifestPath, manifest);

console.log("Synced shared extension files into extension-firefox/.");
