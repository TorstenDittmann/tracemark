// Groups (companies, teams, ...): list and detail models shared by the server and the pages.
import { formatPersonCursor, parsePersonCursor } from './persons';

export interface GroupTypeSummary {
	type: string;
	/** Distinct groups of this type with events in the lookback window. */
	groups: number;
	events: number;
}

export interface GroupSummary {
	key: string;
	/** Events in the lookback window. */
	events: number;
	/** People with events in the group in the lookback window. */
	people: number;
	/** ISO 8601 in UTC, within the lookback window. */
	firstSeen: string;
	lastSeen: string;
	properties: Record<string, unknown>;
}

/** A position in the group list: groups seen strictly before this one come next. */
export interface GroupCursor {
	lastSeen: string;
	key: string;
}

export interface GroupPage {
	groups: GroupSummary[];
	next: GroupCursor | null;
}

export function formatGroupCursor(cursor: GroupCursor): string {
	return formatPersonCursor({ lastSeen: cursor.lastSeen, person: cursor.key });
}

export function parseGroupCursor(value: string | null): GroupCursor | undefined {
	const cursor = parsePersonCursor(value);
	return cursor && { lastSeen: cursor.lastSeen, key: cursor.person };
}

/** What to call a group: its name property when it has one, otherwise its key. */
export function groupName(key: string, properties: Record<string, unknown>): string {
	for (const name of ['name', '$name', 'title']) {
		const value = properties[name];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return key;
}

export function groupsHref(projectId: string, type?: string): string {
	const base = `/projects/${projectId}/groups`;
	return type ? `${base}?type=${encodeURIComponent(type)}` : base;
}

export function groupHref(projectId: string, type: string, key: string): string {
	return `/projects/${projectId}/groups/${encodeURIComponent(type)}/${encodeURIComponent(key)}`;
}
