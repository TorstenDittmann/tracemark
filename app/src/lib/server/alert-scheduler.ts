// Checks alert rules every minute and sends what fired (see docs/alerts.md).
//
// Every app replica runs the timer, but only the one holding the `alerts` lease in libSQL checks
// rules; the others take over once it stops renewing. State lives on each rule's row, so a
// condition fires once when it starts and, optionally, once when it clears.

import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { ALERT_WINDOWS, alertsHref, breaches, formatUsd, ruleSummary } from '../alerts';
import { issueHref, issuesHref } from '../issues';
import type { AlertIssue } from './alert-checks';
import { type AlertMessage, issueLines } from './alert-delivery';
import { ruleSpec, sendAlert } from './alerts';
import type { Db } from './db/client';
import {
	type AlertDestination,
	type AlertRule,
	alertDestinations,
	alertRuleDestinations,
	alertRules,
	errorIssues,
	jobLeases,
	projects
} from './db/schema';

export const CHECK_EVERY_MS = 60_000;
/** Longer than a check takes, so a running holder keeps the lease. */
export const LEASE_MS = 120_000;
/** Exceptions stored in the last moments may not be visible yet; issue rules look this far behind. */
export const ISSUE_LAG_MS = 30_000;
/** After downtime, issue rules catch up on at most this much. */
const MAX_CATCH_UP_MS = 24 * 60 * 60_000;
/** Resolved issues a regression check looks at, most recently resolved first. */
const MAX_RESOLVED = 1000;

/** The ClickHouse side of the checks, bound to a connection (see alert-checks.ts). */
export interface AlertChecks {
	newIssues(projectId: string, from: Date, to: Date): Promise<AlertIssue[]>;
	regressedIssues(
		projectId: string,
		resolved: { fingerprint: string; resolvedAt: Date }[],
		from: Date,
		to: Date
	): Promise<AlertIssue[]>;
	eventCount(projectId: string, event: string, from: Date, to: Date): Promise<number>;
	aiCost(projectId: string, from: Date, to: Date): Promise<number>;
}

export interface CheckOptions {
	now?: Date;
	/** The instance's public URL, for links in messages; none when empty. */
	baseUrl?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

/**
 * Takes or renews a named lease until `now + ttlMs`. True when `holder` has it: nobody had it,
 * `holder` already did, or the last holder's lease ran out.
 */
export async function acquireLease(
	db: Db,
	name: string,
	holder: string,
	ttlMs: number,
	now = new Date()
): Promise<boolean> {
	const expiresAt = new Date(now.getTime() + ttlMs);
	const rows = await db
		.insert(jobLeases)
		.values({ name, holder, expiresAt })
		.onConflictDoUpdate({
			target: jobLeases.name,
			set: { holder, expiresAt },
			setWhere: or(eq(jobLeases.holder, holder), lt(jobLeases.expiresAt, now))
		})
		.returning({ holder: jobLeases.holder });
	return rows.length > 0;
}

type Project = { id: string; name: string };
type Update = Partial<
	Pick<
		AlertRule,
		'state' | 'stateNotified' | 'lastValue' | 'checkedUntil' | 'lastFiredAt' | 'lastError'
	>
>;

const link = (baseUrl: string | undefined, path: string) =>
	baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : undefined;

async function checkIssueRule(
	db: Db,
	checks: AlertChecks,
	rule: AlertRule,
	project: Project,
	now: Date,
	baseUrl: string | undefined
): Promise<{ update: Update; message?: AlertMessage }> {
	const spec = ruleSpec(rule);
	if (spec.kind !== 'issue') throw new Error('not an issue rule');
	const to = new Date(now.getTime() - ISSUE_LAG_MS);
	const start = (rule.checkedUntil ?? rule.createdAt).getTime();
	const from = new Date(Math.max(start, to.getTime() - MAX_CATCH_UP_MS));
	if (to <= from) return { update: {} };

	const found = spec.config.newIssues ? await checks.newIssues(project.id, from, to) : [];
	let regressed: AlertIssue[] = [];
	if (spec.config.regressions) {
		const resolved = await db
			.select({ fingerprint: errorIssues.fingerprint, resolvedAt: errorIssues.statusChangedAt })
			.from(errorIssues)
			.where(and(eq(errorIssues.projectId, project.id), eq(errorIssues.status, 'resolved')))
			.orderBy(desc(errorIssues.statusChangedAt))
			.limit(MAX_RESOLVED);
		regressed = await checks.regressedIssues(project.id, resolved, from, to);
	}
	const update: Update = { checkedUntil: to };
	if (!found.length && !regressed.length) return { update };

	const issues = [...found, ...regressed].map((issue) => ({
		...issue,
		url: link(baseUrl, issueHref(project.id, issue.fingerprint))
	}));
	const [only] = issues;
	const counted = [
		found.length && `${found.length} new ${found.length === 1 ? 'issue' : 'issues'}`,
		regressed.length &&
			`${regressed.length} ${regressed.length === 1 ? 'regression' : 'regressions'}`
	].filter(Boolean);
	const title =
		issues.length === 1 && only
			? `${found.length ? 'New issue' : 'Issue regressed'} in ${project.name}: ${only.type}`
			: `${counted.join(' and ')} in ${project.name}`;
	const lines = [
		...issueLines(found).map((line) => `New: ${line}`),
		...issueLines(regressed).map((line) => `Regressed: ${line}`)
	];
	return {
		update: { ...update, lastFiredAt: now },
		message: {
			status: 'firing',
			title,
			lines: [`Rule: ${rule.name}`, ...lines],
			url: issues.length === 1 && only ? only.url : link(baseUrl, issuesHref(project.id)),
			project,
			rule: { id: rule.id, name: rule.name, kind: rule.kind },
			issues,
			timestamp: now
		}
	};
}

async function checkThresholdRule(
	checks: AlertChecks,
	rule: AlertRule,
	project: Project,
	now: Date,
	baseUrl: string | undefined
): Promise<{ update: Update; message?: AlertMessage }> {
	const spec = ruleSpec(rule);
	if (spec.kind === 'issue') throw new Error('not a threshold rule');
	const { window, threshold } = spec.config;
	const from = new Date(now.getTime() - ALERT_WINDOWS[window].minutes * 60_000);
	const value =
		spec.kind === 'metric'
			? await checks.eventCount(project.id, spec.config.event, from, now)
			: await checks.aiCost(project.id, from, now);
	const comparison = spec.kind === 'metric' ? spec.config.comparison : 'above';
	const firing = breaches(value, comparison, threshold);
	const update: Update = { lastValue: value };
	const shown = (n: number) => (spec.kind === 'ai_cost' ? formatUsd(n) : n.toLocaleString('en'));
	const measured =
		spec.kind === 'metric'
			? `${shown(value)} ${spec.config.event ? `${spec.config.event} events` : 'events'} in the ${ALERT_WINDOWS[window].label}`
			: `${shown(value)} of AI cost in the ${ALERT_WINDOWS[window].label}`;
	const message = (status: 'firing' | 'resolved'): AlertMessage => ({
		status,
		title: `${status === 'resolved' ? 'Resolved: ' : ''}${rule.name} in ${project.name}`,
		lines: [
			status === 'resolved' ? `Back to normal: ${measured}` : `Now ${measured}`,
			`Rule: ${ruleSummary(spec)}`
		],
		url: link(
			baseUrl,
			spec.kind === 'ai_cost' ? `/projects/${project.id}/ai` : alertsHref(project.id)
		),
		project,
		rule: { id: rule.id, name: rule.name, kind: rule.kind },
		value,
		threshold,
		timestamp: now
	});

	if (firing && rule.state === 'ok') {
		const cooled =
			!rule.lastFiredAt ||
			now.getTime() - rule.lastFiredAt.getTime() >= rule.cooldownMinutes * 60_000;
		return {
			update: {
				...update,
				state: 'firing',
				stateNotified: cooled,
				...(cooled ? { lastFiredAt: now } : {})
			},
			message: cooled ? message('firing') : undefined
		};
	}
	if (!firing && rule.state === 'firing') {
		return {
			update: { ...update, state: 'ok', stateNotified: false },
			message: rule.notifyResolved && rule.stateNotified ? message('resolved') : undefined
		};
	}
	return { update };
}

/** Checks every enabled rule once and sends what fired. Returns the number of messages sent. */
export async function checkAlerts(
	db: Db,
	checks: AlertChecks,
	options: CheckOptions = {}
): Promise<number> {
	const now = options.now ?? new Date();
	const rows = await db
		.select({ rule: alertRules, project: { id: projects.id, name: projects.name } })
		.from(alertRules)
		.innerJoin(projects, eq(projects.id, alertRules.projectId))
		.where(eq(alertRules.enabled, true));
	if (!rows.length) return 0;
	const links = await db
		.select({ ruleId: alertRuleDestinations.ruleId, destination: alertDestinations })
		.from(alertRuleDestinations)
		.innerJoin(alertDestinations, eq(alertDestinations.id, alertRuleDestinations.destinationId))
		.where(
			inArray(
				alertRuleDestinations.ruleId,
				rows.map((r) => r.rule.id)
			)
		);
	const destinationsOf = (ruleId: string): AlertDestination[] =>
		links.filter((l) => l.ruleId === ruleId).map((l) => l.destination);

	let sent = 0;
	for (const { rule, project } of rows) {
		let update: Update;
		try {
			const result =
				rule.kind === 'issue'
					? await checkIssueRule(db, checks, rule, project, now, options.baseUrl)
					: await checkThresholdRule(checks, rule, project, now, options.baseUrl);
			update = { ...result.update, lastError: null };
			const destinations = destinationsOf(rule.id);
			if (result.message && destinations.length) {
				await sendAlert(db, destinations, result.message, {
					ruleId: rule.id,
					fetch: options.fetch,
					timeoutMs: options.timeoutMs
				});
				sent += 1;
			}
		} catch (err) {
			console.error(`alert rule ${rule.id} could not be checked:`, err);
			update = { lastError: err instanceof Error ? err.message.slice(0, 500) : String(err) };
		}
		await db
			.update(alertRules)
			.set({ ...update, lastCheckedAt: now })
			.where(eq(alertRules.id, rule.id));
	}
	return sent;
}

/**
 * Checks alerts every minute while this replica holds the lease. Returns a stop function.
 * A check still running when the next one is due makes that one skip.
 */
export function startAlertScheduler(
	getDb: () => Db,
	checks: AlertChecks,
	options: Omit<CheckOptions, 'now'> = {}
): () => void {
	const holder = crypto.randomUUID();
	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			const db = getDb();
			if (await acquireLease(db, 'alerts', holder, LEASE_MS)) {
				await checkAlerts(db, checks, options);
			}
		} catch (err) {
			console.error('alert check failed:', err);
		} finally {
			running = false;
		}
	};
	const first = setTimeout(tick, 15_000);
	const timer = setInterval(tick, CHECK_EVERY_MS);
	return () => {
		clearTimeout(first);
		clearInterval(timer);
	};
}
