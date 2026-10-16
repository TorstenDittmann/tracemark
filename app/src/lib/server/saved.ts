import { and, asc, desc, eq, max } from 'drizzle-orm';
import {
	type FunnelQuery,
	parseFunnel,
	parseRetention,
	parseTrends,
	type RetentionQuery,
	type TrendsQuery
} from '../insights';
import type { Db } from './db/client';
import { dashboardInsights, dashboards, type Insight, insights } from './db/schema';

export type InsightKind = Insight['kind'];

export type SavedQuery =
	| { kind: 'trends'; query: TrendsQuery }
	| { kind: 'funnel'; query: FunnelQuery }
	| { kind: 'retention'; query: RetentionQuery };

export function isInsightKind(value: unknown): value is InsightKind {
	return value === 'trends' || value === 'funnel' || value === 'retention';
}

/** Parses a stored or submitted query for its kind, dropping anything invalid. */
export function parseSavedQuery(kind: InsightKind, json: string): SavedQuery {
	let raw: unknown = null;
	try {
		raw = JSON.parse(json);
	} catch {}
	switch (kind) {
		case 'trends':
			return { kind, query: parseTrends(raw) };
		case 'funnel':
			return { kind, query: parseFunnel(raw) };
		case 'retention':
			return { kind, query: parseRetention(raw) };
	}
}

export function validateName(name: string): string | null {
	if (!name) return 'Enter a name.';
	if (name.length > 100) return 'Use at most 100 characters.';
	return null;
}

// SQLite doesn't enforce the kind enum, so rows with an unknown kind (hand-edited, or from a
// newer version) are left out rather than breaking the pages that list them.

export async function listInsights(db: Db, projectId: string) {
	const rows = await db
		.select()
		.from(insights)
		.where(eq(insights.projectId, projectId))
		.orderBy(desc(insights.updatedAt));
	return rows.filter((row) => isInsightKind(row.kind));
}

export async function getInsight(db: Db, projectId: string, insightId: string) {
	const [row] = await db
		.select()
		.from(insights)
		.where(and(eq(insights.projectId, projectId), eq(insights.id, insightId)));
	return row && isInsightKind(row.kind) ? row : null;
}

export async function createInsight(
	db: Db,
	values: { projectId: string; name: string; saved: SavedQuery; userId: string }
) {
	const [row] = await db
		.insert(insights)
		.values({
			projectId: values.projectId,
			name: values.name,
			kind: values.saved.kind,
			query: JSON.stringify(values.saved.query),
			createdBy: values.userId
		})
		.returning();
	return row;
}

/** Updates name and query; returns false when the insight is not in the project. */
export async function updateInsight(
	db: Db,
	projectId: string,
	insightId: string,
	values: { name: string; saved: SavedQuery }
): Promise<boolean> {
	const rows = await db
		.update(insights)
		.set({ name: values.name, kind: values.saved.kind, query: JSON.stringify(values.saved.query) })
		.where(and(eq(insights.projectId, projectId), eq(insights.id, insightId)))
		.returning({ id: insights.id });
	return rows.length > 0;
}

export async function deleteInsight(db: Db, projectId: string, insightId: string) {
	await db
		.delete(insights)
		.where(and(eq(insights.projectId, projectId), eq(insights.id, insightId)));
}

export async function listDashboards(db: Db, projectId: string) {
	return db
		.select()
		.from(dashboards)
		.where(eq(dashboards.projectId, projectId))
		.orderBy(asc(dashboards.name));
}

export async function getDashboard(db: Db, projectId: string, dashboardId: string) {
	const [row] = await db
		.select()
		.from(dashboards)
		.where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, dashboardId)));
	return row ?? null;
}

export async function createDashboard(db: Db, projectId: string, name: string) {
	const [row] = await db.insert(dashboards).values({ projectId, name }).returning();
	return row;
}

export async function renameDashboard(
	db: Db,
	projectId: string,
	dashboardId: string,
	name: string
) {
	await db
		.update(dashboards)
		.set({ name })
		.where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, dashboardId)));
}

export async function deleteDashboard(db: Db, projectId: string, dashboardId: string) {
	await db
		.delete(dashboards)
		.where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, dashboardId)));
}

/** A dashboard's insights in order. */
export async function dashboardItems(db: Db, dashboardId: string) {
	const rows = await db
		.select({ insight: insights, position: dashboardInsights.position })
		.from(dashboardInsights)
		.innerJoin(insights, eq(insights.id, dashboardInsights.insightId))
		.where(eq(dashboardInsights.dashboardId, dashboardId))
		.orderBy(asc(dashboardInsights.position));
	return rows.filter((row) => isInsightKind(row.insight.kind));
}

/**
 * Appends an insight to a dashboard. Both must belong to the project; adding one that is
 * already there does nothing. Returns false when either is missing.
 */
export async function addToDashboard(
	db: Db,
	projectId: string,
	dashboardId: string,
	insightId: string
): Promise<boolean> {
	const [dashboard, insight] = await Promise.all([
		getDashboard(db, projectId, dashboardId),
		getInsight(db, projectId, insightId)
	]);
	if (!dashboard || !insight) return false;
	const [{ last }] = await db
		.select({ last: max(dashboardInsights.position) })
		.from(dashboardInsights)
		.where(eq(dashboardInsights.dashboardId, dashboardId));
	await db
		.insert(dashboardInsights)
		.values({ dashboardId, insightId, position: (last ?? -1) + 1 })
		.onConflictDoNothing();
	return true;
}

export async function removeFromDashboard(
	db: Db,
	projectId: string,
	dashboardId: string,
	insightId: string
) {
	if (!(await getDashboard(db, projectId, dashboardId))) return;
	await db
		.delete(dashboardInsights)
		.where(
			and(
				eq(dashboardInsights.dashboardId, dashboardId),
				eq(dashboardInsights.insightId, insightId)
			)
		);
}

/** Moves an insight one place up (-1) or down (1) on a dashboard. */
export async function moveOnDashboard(
	db: Db,
	projectId: string,
	dashboardId: string,
	insightId: string,
	direction: -1 | 1
) {
	if (!(await getDashboard(db, projectId, dashboardId))) return;
	const items = await dashboardItems(db, dashboardId);
	const from = items.findIndex((item) => item.insight.id === insightId);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= items.length) return;
	const order = items.map((item) => item.insight.id);
	[order[from], order[to]] = [order[to], order[from]];
	await db.transaction(async (tx) => {
		for (const [position, id] of order.entries()) {
			await tx
				.update(dashboardInsights)
				.set({ position })
				.where(
					and(eq(dashboardInsights.dashboardId, dashboardId), eq(dashboardInsights.insightId, id))
				);
		}
	});
}
