// Alert rules and webhook destinations (see docs/alerts.md), shared by the page and the server.

export type AlertKind = 'issue' | 'metric' | 'ai_cost';
export type AlertFormat = 'json' | 'slack' | 'discord';
export type AlertWindow = '15m' | '1h' | '6h' | '1d' | '7d';
export type Comparison = 'above' | 'below';

export const ALERT_KINDS: Record<AlertKind, string> = {
	issue: 'Error issue',
	metric: 'Event count',
	ai_cost: 'AI cost'
};

export const ALERT_FORMATS: Record<AlertFormat, string> = {
	json: 'Generic JSON',
	slack: 'Slack',
	discord: 'Discord'
};

/** Window lengths in minutes, and how a message names them. */
export const ALERT_WINDOWS: Record<AlertWindow, { minutes: number; label: string }> = {
	'15m': { minutes: 15, label: 'last 15 minutes' },
	'1h': { minutes: 60, label: 'last hour' },
	'6h': { minutes: 360, label: 'last 6 hours' },
	'1d': { minutes: 1440, label: 'last day' },
	'7d': { minutes: 10080, label: 'last 7 days' }
};

export interface IssueRuleConfig {
	newIssues: boolean;
	regressions: boolean;
}

export interface MetricRuleConfig {
	/** Empty counts every event. */
	event: string;
	window: AlertWindow;
	comparison: Comparison;
	threshold: number;
}

export interface AiCostRuleConfig {
	window: AlertWindow;
	/** USD. */
	threshold: number;
}

export type AlertRuleSpec =
	| { kind: 'issue'; config: IssueRuleConfig }
	| { kind: 'metric'; config: MetricRuleConfig }
	| { kind: 'ai_cost'; config: AiCostRuleConfig };

/** What the destination dialog edits; secrets never reach the browser. */
export interface DestinationDraft {
	id?: string;
	name: string;
	url: string;
	format: AlertFormat;
	hasSecret: boolean;
}

/** What the rule dialog edits. */
export interface RuleDraft {
	id?: string;
	name: string;
	spec: AlertRuleSpec;
	destinationIds: string[];
	enabled: boolean;
	notifyResolved: boolean;
	cooldownMinutes: number;
}

export const MAX_NAME = 100;
export const COOLDOWNS = [0, 15, 60, 240, 1440];

export const alertsHref = (projectId: string) => `/projects/${projectId}/alerts`;

export function formatUsd(value: number): string {
	return `$${value.toFixed(value !== 0 && Math.abs(value) < 1 ? 4 : 2)}`;
}

export function cooldownLabel(minutes: number): string {
	if (minutes === 0) return 'No cooldown';
	if (minutes < 60) return `${minutes} minutes`;
	if (minutes < 1440) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
	return minutes === 1440 ? '1 day' : `${minutes / 1440} days`;
}

/** What a rule watches for, in a sentence. */
export function ruleSummary(rule: AlertRuleSpec): string {
	switch (rule.kind) {
		case 'issue': {
			const { newIssues, regressions } = rule.config;
			if (newIssues && regressions) return 'A new issue appears or a resolved issue regresses';
			if (regressions) return 'A resolved issue regresses';
			return 'A new issue appears';
		}
		case 'metric': {
			const { event, window, comparison, threshold } = rule.config;
			const events = event ? `${event} events` : 'events';
			const more = comparison === 'above' ? 'More than' : 'Fewer than';
			return `${more} ${threshold.toLocaleString('en')} ${events} in the ${ALERT_WINDOWS[window].label}`;
		}
		case 'ai_cost':
			return `AI cost above ${formatUsd(rule.config.threshold)} in the ${ALERT_WINDOWS[rule.config.window].label}`;
	}
}

/** Whether a measured value breaks a threshold rule. */
export function breaches(value: number, comparison: Comparison, threshold: number): boolean {
	return comparison === 'above' ? value > threshold : value < threshold;
}
