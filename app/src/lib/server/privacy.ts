// Retention and per-person data requests (export and erasure) over ClickHouse.

import { eq } from 'drizzle-orm';
import type { ClickHouseConfig } from './clickhouse';
import { clickhouseQuery } from './clickhouse';
import type { Db } from './db/client';
import { projects } from './db/schema';
import { chTime } from './web';

/** Most events one person export holds; more are left out and the export says so. */
export const MAX_EXPORT_EVENTS = 100_000;
/** How often the app removes events past each project's retention. */
export const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

export async function setRetention(db: Db, projectId: string, days: number | null) {
	await db.update(projects).set({ retentionDays: days }).where(eq(projects.id, projectId));
}

/**
 * Deletes events older than each project's retention. Lightweight deletes: rows leave queries at
 * once and disk on the next merge. People and group properties stay, as they describe the present.
 */
export async function sweepRetention(
	config: ClickHouseConfig,
	list: { id: string; retentionDays: number | null }[],
	now = new Date()
): Promise<number> {
	let swept = 0;
	for (const project of list) {
		if (!project.retentionDays) continue;
		const cutoff = new Date(now.getTime() - project.retentionDays * 86_400_000);
		await clickhouseQuery(
			config,
			`DELETE FROM events
			WHERE project_id = {project:UUID} AND timestamp < {cutoff:DateTime64(3, 'UTC')}`,
			{ params: { project: project.id, cutoff: chTime(cutoff) } }
		);
		swept += 1;
	}
	return swept;
}

export interface ExportedEvent {
	uuid: string;
	event: string;
	timestamp: string;
	distinct_id: string;
	session_id: string;
	properties: Record<string, unknown>;
}

/** A person's events, oldest first, up to MAX_EXPORT_EVENTS (`truncated` when there are more). */
export async function personEvents(
	config: ClickHouseConfig,
	projectId: string,
	distinctIds: string[],
	limit = MAX_EXPORT_EVENTS
): Promise<{ events: ExportedEvent[]; truncated: boolean }> {
	const body = await clickhouseQuery(
		config,
		`SELECT toString(uuid) AS uuid, event,
			toUnixTimestamp64Milli(timestamp) AS ts,
			distinct_id, session_id, toJSONString(properties) AS properties
		FROM events
		WHERE project_id = {project:UUID} AND distinct_id IN {ids:Array(String)}
		ORDER BY ts, uuid
		LIMIT {limit:UInt32}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, ids: distinctIds, limit: String(limit + 1) } }
	);
	const events = body
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const { ts, properties, ...row } = JSON.parse(line) as Omit<
				ExportedEvent,
				'properties' | 'timestamp'
			> & { ts: string; properties: string };
			return {
				...row,
				timestamp: new Date(Number(ts)).toISOString(),
				properties: JSON.parse(properties) as Record<string, unknown>
			};
		});
	return { events: events.slice(0, limit), truncated: events.length > limit };
}

/**
 * Erases a person: their events, identity links, person properties and static cohort
 * memberships. Events sent later under one of their ids start a new person.
 */
export async function deletePersonData(
	config: ClickHouseConfig,
	projectId: string,
	person: string,
	distinctIds: string[]
): Promise<void> {
	const params = { project: projectId, ids: distinctIds, person };
	for (const statement of [
		'DELETE FROM events WHERE project_id = {project:UUID} AND distinct_id IN {ids:Array(String)}',
		`DELETE FROM person_aliases WHERE project_id = {project:UUID}
			AND (alias IN {ids:Array(String)} OR distinct_id IN {ids:Array(String)})`,
		'DELETE FROM person_properties WHERE project_id = {project:UUID} AND distinct_id IN {ids:Array(String)}',
		'DELETE FROM cohort_people WHERE project_id = {project:UUID} AND person = {person:String}'
	]) {
		await clickhouseQuery(config, statement, { params });
	}
}
