import type { ClickHouseConfig } from '../src/lib/server/clickhouse';
import { createDb } from '../src/lib/server/db/client';

const env = (name: string, fallback: string) => process.env[name] || fallback;

export const databaseUrl = env('DATABASE_URL', 'file:./data/tracemark.db');

export const db = () => createDb(databaseUrl, process.env.DATABASE_AUTH_TOKEN);

export const clickhouse: ClickHouseConfig = {
	url: env('CLICKHOUSE_URL', 'http://localhost:8123'),
	user: env('CLICKHOUSE_USER', 'default'),
	password: env('CLICKHOUSE_PASSWORD', ''),
	database: env('CLICKHOUSE_DATABASE', 'tracemark')
};
