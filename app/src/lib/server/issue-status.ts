// Triage status of error issues in libSQL. Issues without a row are open.
import { and, eq, inArray } from 'drizzle-orm';
import type { IssueStatus } from '../issues';
import type { Db } from './db/client';
import { type ErrorIssue, errorIssues } from './db/schema';

/** Stored statuses for a project's issues, by fingerprint; pass `fingerprints` to narrow. */
export async function issueStatuses(
	db: Db,
	projectId: string,
	fingerprints?: string[]
): Promise<Map<string, ErrorIssue>> {
	if (fingerprints?.length === 0) return new Map();
	const rows = await db
		.select()
		.from(errorIssues)
		.where(
			and(
				eq(errorIssues.projectId, projectId),
				fingerprints ? inArray(errorIssues.fingerprint, fingerprints) : undefined
			)
		);
	return new Map(rows.map((row) => [row.fingerprint, row]));
}

export async function setIssueStatus(
	db: Db,
	values: { projectId: string; fingerprint: string; status: IssueStatus; userId: string },
	now = new Date()
) {
	const set = { status: values.status, statusChangedAt: now, statusChangedBy: values.userId };
	await db
		.insert(errorIssues)
		.values({ projectId: values.projectId, fingerprint: values.fingerprint, ...set })
		.onConflictDoUpdate({ target: [errorIssues.projectId, errorIssues.fingerprint], set });
}
