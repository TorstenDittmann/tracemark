import {
	listTraces,
	scoreNames,
	type TraceFilter,
	type TraceSummary
} from '#lib/server/analytics.js';
import { parseRange } from '#lib/web.js';
import type { PageServerLoad } from './$types';

const number = (value: string | null) => {
	if (value === null || value.trim() === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
};

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	const filter: TraceFilter = {
		person: url.searchParams.get('person') || undefined,
		score: url.searchParams.get('score') || undefined,
		min: number(url.searchParams.get('min')),
		max: number(url.searchParams.get('max')),
		negative: url.searchParams.get('negative') === '1' || undefined
	};
	let traces: TraceSummary[] | null = null;
	let names: string[] = [];
	try {
		[traces, names] = await Promise.all([
			listTraces(project.id, { range, ...filter }),
			scoreNames(project.id, { range })
		]);
	} catch (err) {
		console.error('AI traces unavailable:', err);
	}
	return { range, person: filter.person, filter, scoreNames: names, traces };
};
