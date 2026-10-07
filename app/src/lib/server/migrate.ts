import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import type { Db } from './db/client';

export async function migrateLibsql(db: Db, migrationsFolder: string): Promise<void> {
	await migrate(db, { migrationsFolder });
}

/**
 * Applies `*.sql` files from `folder` in name order, once each.
 * Applied names are recorded in the `_migrations` table of the target database.
 */
export async function migrateClickhouse(
	config: ClickHouseConfig,
	folder: string
): Promise<string[]> {
	if (!/^\w+$/.test(config.database)) {
		throw new Error(`invalid ClickHouse database name: ${config.database}`);
	}
	await clickhouseQuery(config, `CREATE DATABASE IF NOT EXISTS ${config.database}`, {
		database: null
	});
	await clickhouseQuery(
		config,
		`CREATE TABLE IF NOT EXISTS _migrations (name String, applied_at DateTime DEFAULT now())
		ENGINE = MergeTree ORDER BY name`
	);

	const applied = new Set(
		(await clickhouseQuery(config, 'SELECT name FROM _migrations FORMAT TabSeparated'))
			.split('\n')
			.filter(Boolean)
	);
	const files = (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort();

	const newlyApplied: string[] = [];
	for (const file of files) {
		if (applied.has(file)) continue;
		const sql = await readFile(join(folder, file), 'utf8');
		for (const statement of splitStatements(sql)) {
			await clickhouseQuery(config, statement);
		}
		await clickhouseQuery(
			config,
			`INSERT INTO _migrations (name) VALUES ('${file.replaceAll("'", '')}')`
		);
		newlyApplied.push(file);
	}
	return newlyApplied;
}

/** Splits a SQL file on `;` at line ends. Migrations must not contain `;` inside string literals at a line end. */
export function splitStatements(sql: string): string[] {
	return sql
		.split(/;\s*$/m)
		.map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
		.filter(Boolean);
}
