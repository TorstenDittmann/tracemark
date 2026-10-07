import { DATABASE_AUTH_TOKEN, DATABASE_URL } from '$app/env/private';
import { createDb, type Db } from './client';

let instance: Db | undefined;

/** The app's libSQL connection, opened on first use so builds never touch the database. */
export function getDb(): Db {
	instance ??= createDb(DATABASE_URL, DATABASE_AUTH_TOKEN);
	return instance;
}
