// Cohorts: named sets of people, either a static list or everyone matching person property filters.
import { type PropertyFilter, parsePropertyFilters } from './insights';

export { parseCohortId } from './insights';

export const COHORT_KINDS = {
	static: 'Static list',
	properties: 'Person properties'
} as const;

export type CohortKind = keyof typeof COHORT_KINDS;

/** What an insight or list needs to know to narrow to a cohort's people. */
export type CohortSpec =
	| { kind: 'static'; id: string }
	| { kind: 'properties'; id: string; filters: PropertyFilter[] };

/** People pasted into a static cohort at once, at most. */
export const MAX_COHORT_ADD = 1000;

/** Person property filters as stored, dropping anything invalid. */
export function parseCohortFilters(json: string): PropertyFilter[] {
	try {
		return parsePropertyFilters(JSON.parse(json));
	} catch {
		return [];
	}
}

/** Distinct ids pasted one per line or separated by commas: trimmed, deduplicated, capped. */
export function parseIdList(text: string): string[] {
	const ids = new Set<string>();
	for (const part of text.split(/[\n,]/)) {
		const id = part.trim();
		// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
		if (id && id.length <= 200 && !/[\u0000-\u001f]/.test(id)) ids.add(id);
		if (ids.size === MAX_COHORT_ADD) break;
	}
	return [...ids];
}

export function cohortHref(projectId: string, cohortId: string): string {
	return `/projects/${projectId}/cohorts/${cohortId}`;
}
