import { error } from '@sveltejs/kit';
import type { AiEvent, AiScore } from '#lib/ai.js';
import { traceEvents, traceScores } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { project } = await parent();
	let events: AiEvent[] | null = null;
	let scores: AiScore[] = [];
	try {
		[events, scores] = await Promise.all([
			traceEvents(project.id, params.traceId),
			traceScores(project.id, params.traceId)
		]);
	} catch (err) {
		console.error('AI trace unavailable:', err);
	}
	if (events && !events.length) error(404, 'Trace not found');
	return { traceId: params.traceId, events, scores };
};
