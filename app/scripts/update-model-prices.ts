// Refreshes the model price snapshot the app ships with, from models.dev or a local api.json.
// Usage: bun run prices:update [url-or-file]
import { readFile, writeFile } from 'node:fs/promises';
import { MODELS_DEV_URL, parseCatalog } from '../src/lib/server/models-dev';

const source = process.argv[2] ?? MODELS_DEV_URL;
const catalog = /^https?:\/\//.test(source)
	? await (await fetch(source)).json()
	: JSON.parse(await readFile(source, 'utf8'));
const prices = parseCatalog(catalog);
if (prices.length === 0) throw new Error(`no prices in ${source}`);

const file = new URL('../src/lib/server/model-prices.json', import.meta.url);
const updated = new Date().toISOString().slice(0, 10);
await writeFile(
	file,
	`${JSON.stringify({ source: MODELS_DEV_URL, updated, prices }, null, '\t')}\n`
);
console.log(`Wrote ${prices.length} model prices.`);
