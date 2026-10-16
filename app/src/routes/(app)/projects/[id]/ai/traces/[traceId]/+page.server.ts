import { error } from '@sveltejs/kit';
import type { AiEvent } from '#lib/ai.js';
import { traceEvents } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { project } = await parent();
	let events: AiEvent[] | null = null;
	try {
		events = await traceEvents(project.id, params.traceId);
	} catch (err) {
		console.error('AI trace unavailable:', err);
	}
	if (events && !events.length) error(404, 'Trace not found');
	return { traceId: params.traceId, events };
};
