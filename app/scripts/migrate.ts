// Applies libSQL and ClickHouse migrations. Run before starting the app: `bun run migrate`.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { migrateClickhouse, migrateLibsql } from '../src/lib/server/migrate';
import { clickhouse, databaseUrl, db } from './config';

const root = resolve(import.meta.dir, '..');

if (databaseUrl.startsWith('file:')) {
	await mkdir(dirname(resolve(root, databaseUrl.slice('file:'.length))), { recursive: true });
}

await migrateLibsql(db(), resolve(root, 'drizzle'));
console.log('libSQL: up to date');

const applied = await migrateClickhouse(
	clickhouse,
	resolve(root, process.env.CLICKHOUSE_MIGRATIONS ?? '../clickhouse/migrations')
);
console.log(
	applied.length ? `ClickHouse: applied ${applied.join(', ')}` : 'ClickHouse: up to date'
);
