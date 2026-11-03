import {build} from 'esbuild';
// Knap (Obsidian's template language) ships as npm ESM; bundle it so extension pages can import it without a bare specifier.
await build({stdin: {contents: "export {createEngine, standardFilters} from 'knap';", resolveDir: process.cwd()}, bundle: true, outfile: 'extension/vendor/knap.js', format: 'esm', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof'});
