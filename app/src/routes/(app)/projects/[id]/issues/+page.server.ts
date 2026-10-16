import { currentStatus, type IssueStatus, parseStatus } from '#lib/issues.js';
import { type IssueSummary, listIssues } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { issueStatuses } from '#lib/server/issue-status.js';
import { parseRange } from '#lib/web.js';
import type { PageServerLoad } from './$types';

type Row = IssueSummary & { status: IssueStatus; regressed: boolean };

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	const status = parseStatus(url.searchParams.get('status'));
	let list: { buckets: string[]; bucket: 'hour' | 'day'; issues: Row[] } | null = null;
	try {
		const found = await listIssues(project.id, { range });
		const stored = await issueStatuses(
			getDb(),
			project.id,
			found.issues.map((issue) => issue.fingerprint)
		);
		list = {
			...found,
			issues: found.issues.map((issue) => ({
				...issue,
				...currentStatus(stored.get(issue.fingerprint), new Date(issue.lastSeen))
			}))
		};
	} catch (err) {
		console.error('issues unavailable:', err);
	}
	const counts: Record<IssueStatus, number> = { open: 0, resolved: 0, ignored: 0 };
	for (const issue of list?.issues ?? []) counts[issue.status] += 1;
	return {
		range,
		status,
		counts,
		list: list && { ...list, issues: list.issues.filter((issue) => issue.status === status) }
	};
};
