import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (fallback: string) => (value: string | undefined) => value || fallback;

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'libSQL URL: file:./data/footprint.db, or libsql://… for sqld/Turso',
		schema: optional('file:./data/footprint.db')
	},
	DATABASE_AUTH_TOKEN: { description: 'Auth token for sqld/Turso', schema: optional('') },
	CLICKHOUSE_URL: { schema: optional('http://localhost:8123') },
	CLICKHOUSE_USER: { schema: optional('default') },
	CLICKHOUSE_PASSWORD: { schema: optional('') },
	CLICKHOUSE_DATABASE: { schema: optional('footprint') },
	INTERNAL_TOKEN: {
		description: 'Shared secret the ingest service sends in x-internal-token',
		schema: optional('')
	}
});
