import { validName } from './insights';

export const MAX_METRICS = 10;
export const MAX_NAME = 200;

/** What an experiment measures for each exposed person, after they first saw the flag. */
export interface ExperimentMetric {
	/** `conversion`: share of people who did the event at least once. `count`: events per person. */
	kind: 'conversion' | 'count';
	event: string;
}

export type ExperimentStatus = 'draft' | 'running' | 'complete';

export const experimentsHref = (projectId: string) => `/projects/${projectId}/experiments`;
export const experimentHref = (projectId: string, experimentId: string) =>
	`/projects/${projectId}/experiments/${experimentId}`;

/** Validates metrics from storage or a form. Throws with a readable message. */
export function parseMetrics(value: unknown): ExperimentMetric[] {
	if (!Array.isArray(value)) throw new Error('Metrics must be a list.');
	if (value.length > MAX_METRICS) throw new Error(`Use at most ${MAX_METRICS} metrics.`);
	return value.map((metric) => {
		const { kind, event } = (metric ?? {}) as Record<string, unknown>;
		if (kind !== 'conversion' && kind !== 'count') throw new Error('Pick a metric type.');
		if (!validName(event)) throw new Error('Pick an event for every metric.');
		return { kind, event };
	});
}

/** Metrics stored as JSON; anything invalid reads as none. */
export function storedMetrics(text: string): ExperimentMetric[] {
	try {
		return parseMetrics(JSON.parse(text));
	} catch {
		return [];
	}
}

export function metricLabel(metric: ExperimentMetric): string {
	return metric.kind === 'conversion'
		? `Converted to ${metric.event}`
		: `${metric.event} per person`;
}
