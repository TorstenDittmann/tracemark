import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (fallback: string) => (value: string | undefined) => value || fallback;

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'libSQL URL: file:./data/tracemark.db, or libsql://… for sqld/Turso',
		schema: optional('file:./data/tracemark.db')
	},
	DATABASE_AUTH_TOKEN: { description: 'Auth token for sqld/Turso', schema: optional('') },
	SOURCEMAPS_DIR: {
		description:
			'Directory for uploaded source maps. Defaults to sourcemaps/ next to a file: database, else ./data/sourcemaps',
		schema: optional('')
	},
	CLICKHOUSE_URL: { schema: optional('http://localhost:8123') },
	CLICKHOUSE_USER: { schema: optional('default') },
	CLICKHOUSE_PASSWORD: { schema: optional('') },
	CLICKHOUSE_DATABASE: { schema: optional('tracemark') },
	PUBLIC_URL: {
		description:
			'Public URL of the instance, e.g. https://analytics.example.com. Inferred per request when empty',
		schema: optional('')
	},
	AUTH_SECRET: {
		description: 'Secret that signs session cookies (openssl rand -hex 32). Required in production',
		schema: optional('')
	},
	MODEL_PRICES_URL: {
		description:
			'Catalog the built-in model prices are refreshed from daily, in models.dev api.json format. off keeps the prices shipped with the app',
		schema: optional('https://models.dev/api.json')
	},
	ALERTS: {
		description:
			'off stops this replica from checking alert rules. Replicas share the work through a lease in libSQL either way',
		schema: optional('on')
	},
	INTERNAL_TOKEN: {
		description: 'Shared secret the ingest service sends in x-internal-token',
		schema: optional('')
	}
});
