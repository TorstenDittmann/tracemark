/** Editor route segment and label for each saved insight kind. */
export const INSIGHT_KINDS = {
	trends: { path: 'trends', label: 'Trends' },
	funnel: { path: 'funnels', label: 'Funnel' },
	retention: { path: 'retention', label: 'Retention' },
	paths: { path: 'paths', label: 'Paths' },
	lifecycle: { path: 'lifecycle', label: 'Lifecycle' }
} as const;

/** The insight editors, in the order the insights navigation and the command menu list them. */
export const INSIGHT_EDITORS = [
	{ path: 'trends', label: 'Trends', description: 'Events and users over time.' },
	{ path: 'funnels', label: 'Funnels', description: 'How many people get through steps in order.' },
	{
		path: 'retention',
		label: 'Retention',
		description: 'Who comes back after they first did something.'
	},
	{ path: 'paths', label: 'Paths', description: 'What people do after or before a page or event.' },
	{
		path: 'lifecycle',
		label: 'Lifecycle',
		description: 'New, returning, resurrecting and dormant users.'
	}
] as const;

export function insightHref(
	projectId: string,
	insight: { id: string; kind: keyof typeof INSIGHT_KINDS }
) {
	return `/projects/${projectId}/insights/${INSIGHT_KINDS[insight.kind].path}?insight=${insight.id}`;
}
