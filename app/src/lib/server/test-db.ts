import { resolve } from 'node:path';
import { createDb } from './db/client';
import { migrateLibsql } from './migrate';

/** A fresh, migrated in-memory database for tests. */
export async function createTestDb() {
	const db = createDb(':memory:');
	await migrateLibsql(db, resolve(import.meta.dirname, '../../../drizzle'));
	return db;
}
