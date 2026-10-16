import { error, fail, redirect } from '@sveltejs/kit';
import { currentStatus, type IssueStatus, STATUSES, validFingerprint } from '#lib/issues.js';
import { type IssueDetail, issueDetail } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { issueStatuses, setIssueStatus } from '#lib/server/issue-status.js';
import { getProjectForUser } from '#lib/server/projects.js';
import { parseRange } from '#lib/web.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, url }) => {
	const { project } = await parent();
	if (!validFingerprint(params.fingerprint)) error(404, 'Issue not found');
	const range = parseRange(url.searchParams.get('range'));
	let issue: IssueDetail | null;
	try {
		issue = await issueDetail(project.id, params.fingerprint, { range });
	} catch (err) {
		console.error('issue unavailable:', err);
		return { range, issue: null, unavailable: true, status: 'open' as const, regressed: false };
	}
	if (!issue) error(404, 'Issue not found');
	const stored = await issueStatuses(getDb(), project.id, [issue.fingerprint]);
	return {
		range,
		issue,
		unavailable: false,
		...currentStatus(stored.get(issue.fingerprint), new Date(issue.lastSeen))
	};
};

export const actions: Actions = {
	// Actions don't run layout loads, so this checks access itself.
	status: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		if (!validFingerprint(params.fingerprint)) error(404, 'Issue not found');
		const status = String((await request.formData()).get('status') ?? '');
		if (!Object.hasOwn(STATUSES, status)) {
			return fail(400, { message: 'Pick open, resolved or ignored.' });
		}
		await setIssueStatus(getDb(), {
			projectId: row.project.id,
			fingerprint: params.fingerprint,
			status: status as IssueStatus,
			userId: locals.user.id
		});
		return { ok: true };
	}
};
