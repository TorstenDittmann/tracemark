// The event and property browser: query models shared by the server and the pages.
import { type PropertyFilter, parsePropertyFilters, validName } from './insights';

/** Which recent events to list: one event name or all of them, with property filters. */
export interface ActivityQuery {
	event?: string;
	filters: PropertyFilter[];
}

export const ACTIVITY_PAGE_SIZE = 50;
/** The activity list and the definitions look this far back. */
export const LOOKBACK_DAYS = 30;

/** Reads an activity query from untrusted JSON. Invalid parts are dropped rather than rejected. */
export function parseActivity(input: unknown): ActivityQuery {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) return { filters: [] };
	const record = input as Record<string, unknown>;
	return {
		event: validName(record.event) ? record.event : undefined,
		filters: parsePropertyFilters(record.filters)
	};
}

export function parseActivityParam(value: string | null): ActivityQuery {
	if (!value) return { filters: [] };
	try {
		return parseActivity(JSON.parse(value));
	} catch {
		return { filters: [] };
	}
}

/** A position in the activity list: events strictly older than this one come next. */
export interface ActivityCursor {
	timestamp: string;
	uuid: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function formatCursor(cursor: ActivityCursor): string {
	return `${cursor.timestamp}_${cursor.uuid}`;
}

/** Reads a `before` URL parameter; anything malformed means "start from the newest". */
export function parseCursor(value: string | null): ActivityCursor | undefined {
	if (!value) return undefined;
	const [timestamp, uuid, ...rest] = value.split('_');
	if (rest.length || !ISO.test(timestamp ?? '') || !UUID.test(uuid ?? '')) return undefined;
	return { timestamp, uuid: uuid.toLowerCase() };
}

export interface ActivityEvent {
	uuid: string;
	event: string;
	/** ISO 8601 in UTC, with milliseconds. */
	timestamp: string;
	distinctId: string;
	/** The identified id for a linked anonymous id, otherwise the distinct id. */
	person: string;
	sessionId: string;
	properties: Record<string, unknown>;
}

/**
 * A readable name for an event: `clicked 'Sign up'` for a click autocaptured on a button,
 * otherwise the event's name.
 */
export function eventSummary(event: string, properties: Record<string, unknown>): string {
	if (event === '$autocapture') {
		const verb = properties.$event_type === 'submit' ? 'submitted' : 'clicked';
		const text = typeof properties.$el_text === 'string' ? properties.$el_text : '';
		const tag = typeof properties.$el_tag === 'string' ? properties.$el_tag : '';
		const what = text ? `'${text}'` : tag === 'a' ? 'a link' : tag === 'form' ? 'a form' : tag;
		return what ? `${verb} ${what}` : verb;
	}
	return event;
}

export interface ActivityPage {
	events: ActivityEvent[];
	/** Where the next, older page starts, or null on the last page. */
	next: ActivityCursor | null;
}

export interface EventDefinition {
	event: string;
	/** Events in the lookback window. */
	count: number;
	/** ISO 8601 in UTC. */
	firstSeen: string;
	lastSeen: string;
}

export interface PropertyDefinition {
	name: string;
	/** Readable value types seen, such as "number" or "string". */
	types: string[];
	/** Events in the lookback window that carry the property. */
	count: number;
}

/** A ClickHouse JSON value type as a short, readable name. */
export function readableType(type: string): string {
	if (/^(U?Int|Float|Decimal)/.test(type)) return 'number';
	if (type === 'Bool') return 'boolean';
	if (type === 'String') return 'string';
	if (type.startsWith('Array')) return 'list';
	if (type.startsWith('DateTime') || type === 'Date' || type === 'Date32') return 'date';
	if (type.startsWith('JSON') || type.startsWith('Object')) return 'object';
	return type.toLowerCase();
}
