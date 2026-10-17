import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Gzip budgets from the plan: the core under 10 KB, each plugin under 3 KB.
const BUDGETS: Record<string, number> = {
	'dist/tracemark.iife.js': 10 * 1024,
	'dist/tracemark-flags.iife.js': 3 * 1024,
	'dist/tracemark-errors.iife.js': 3 * 1024
};
let failed = false;
for (const file of [...Object.keys(BUDGETS), 'dist/index.js', 'dist/flags.js', 'dist/errors.js']) {
	const raw = readFileSync(join(import.meta.dirname, '..', file));
	const gz = gzipSync(raw, { level: 9 }).length;
	console.log(`${file}: ${raw.length} B raw, ${gz} B gzip (${(gz / 1024).toFixed(2)} KB)`);
	const budget = BUDGETS[file];
	if (budget !== undefined && gz > budget) {
		console.error(`${file} exceeds its ${budget} B gzip budget`);
		failed = true;
	}
}
if (failed) process.exit(1);
