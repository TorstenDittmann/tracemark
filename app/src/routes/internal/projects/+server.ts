import { error, json } from '@sveltejs/kit';
import type { ModelPrice } from '#lib/ai-prices.js';
import { builtInPrices } from '#lib/server/builtin-prices.js';
import { getDb } from '#lib/server/db/index.js';
import { aiModelPrices, projects } from '#lib/server/db/schema.js';
import { safeEqual } from '#lib/server/keys.js';
import { currentSalts } from '#lib/server/salts.js';
import { INTERNAL_TOKEN } from '$app/env/private';
import type { RequestHandler } from './$types';

const wire = (price: ModelPrice) => ({
	model: price.model,
	input: price.input,
	output: price.output,
	cache_read: price.cacheRead ?? null,
	cache_write: price.cacheWrite ?? null
});

/**
 * Project keys, cookieless salts and model prices for the ingest service, see
 * docs/ingest-protocol.md.
 */
export const GET: RequestHandler = async ({ request }) => {
	const token = request.headers.get('x-internal-token') ?? '';
	if (!INTERNAL_TOKEN || !safeEqual(token, INTERNAL_TOKEN)) {
		error(401, 'invalid internal token');
	}

	const db = getDb();
	const rows = await db.select({ id: projects.id, public_key: projects.publicKey }).from(projects);
	const overrides: Record<string, ReturnType<typeof wire>[]> = {};
	const own = await db.select().from(aiModelPrices);
	for (const { projectId, cacheRead, cacheWrite, ...price } of own) {
		const list = overrides[projectId] ?? [];
		list.push(
			wire({ ...price, cacheRead: cacheRead ?? undefined, cacheWrite: cacheWrite ?? undefined })
		);
		overrides[projectId] = list;
	}
	return json({
		projects: rows,
		salts: await currentSalts(db),
		model_prices: { defaults: builtInPrices().map(wire), projects: overrides }
	});
};
