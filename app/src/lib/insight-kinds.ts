/** Editor route segment and label for each saved insight kind. */
export const INSIGHT_KINDS = {
	trends: { path: 'trends', label: 'Trends' },
	funnel: { path: 'funnels', label: 'Funnel' },
	retention: { path: 'retention', label: 'Retention' }
} as const;

export function insightHref(
	projectId: string,
	insight: { id: string; kind: keyof typeof INSIGHT_KINDS }
) {
	return `/projects/${projectId}/insights/${INSIGHT_KINDS[insight.kind].path}?insight=${insight.id}`;
}
