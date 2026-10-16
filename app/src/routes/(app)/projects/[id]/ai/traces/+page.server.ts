import { listTraces, type TraceSummary } from '#lib/server/analytics.js';
import { parseRange } from '#lib/web.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	const person = url.searchParams.get('person') || undefined;
	let traces: TraceSummary[] | null = null;
	try {
		traces = await listTraces(project.id, { range, person });
	} catch (err) {
		console.error('AI traces unavailable:', err);
	}
	return { range, person, traces };
};
