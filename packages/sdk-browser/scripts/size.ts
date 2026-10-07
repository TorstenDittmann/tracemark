import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 10 * 1024;
let failed = false;
for (const file of ['dist/footprint.iife.js', 'dist/index.js']) {
	const raw = readFileSync(join(import.meta.dirname, '..', file));
	const gz = gzipSync(raw, { level: 9 }).length;
	console.log(`${file}: ${raw.length} B raw, ${gz} B gzip (${(gz / 1024).toFixed(2)} KB)`);
	if (file.endsWith('iife.js') && gz > LIMIT) failed = true;
}
if (failed) {
	console.error(`IIFE bundle exceeds ${LIMIT} B gzip budget`);
	process.exit(1);
}
