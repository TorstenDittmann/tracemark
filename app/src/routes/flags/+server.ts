import { json } from '@sveltejs/kit';
import { evaluateProjectFlags } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { flagsResponse, MAX_BODY_BYTES, parseFlagsBody } from '#lib/server/flag-api.js';
import { projectByPublicKey } from '#lib/server/projects.js';
import type { RequestHandler } from './$types';

// Browsers call this from any site the SDK runs on, with the public key, like `POST /e`.
const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'POST, OPTIONS',
	'access-control-allow-headers': 'content-type',
	'access-control-max-age': '86400'
};

const failure = (status: number, error: string, message?: string) =>
	json(message ? { error, message } : { error }, { status, headers: CORS });

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });

/** Evaluates every flag of a project for one person, see docs/flags-api.md. */
export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES) return failure(413, 'payload_too_large');
	let parsed: ReturnType<typeof parseFlagsBody>;
	try {
		parsed = parseFlagsBody(JSON.parse(raw));
	} catch (err) {
		return failure(400, 'invalid_request', err instanceof Error ? err.message : undefined);
	}
	const project = await projectByPublicKey(getDb(), parsed.apiKey);
	if (!project) return failure(401, 'invalid_api_key');
	const results = await evaluateProjectFlags(project.id, parsed.request);
	return json(flagsResponse(results), { headers: { ...CORS, 'cache-control': 'no-store' } });
};
