// People: list and detail models shared by the server and the pages.

export interface PersonSummary {
	/** The identified id, or the distinct id of someone never identified. */
	person: string;
	/** Events in the lookback window. */
	events: number;
	/** ISO 8601 in UTC, within the lookback window. */
	firstSeen: string;
	lastSeen: string;
	properties: Record<string, unknown>;
}

/** A position in the people list: people seen strictly before this one come next. */
export interface PersonCursor {
	lastSeen: string;
	person: string;
}

export interface PersonPage {
	persons: PersonSummary[];
	next: PersonCursor | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function formatPersonCursor(cursor: PersonCursor): string {
	return `${cursor.lastSeen}_${cursor.person}`;
}

/** Reads a `before` URL parameter; anything malformed means "start from the most recent". */
export function parsePersonCursor(value: string | null): PersonCursor | undefined {
	if (!value) return undefined;
	const split = value.indexOf('_');
	if (split < 0) return undefined;
	const lastSeen = value.slice(0, split);
	const person = value.slice(split + 1);
	if (!ISO.test(lastSeen) || !person || person.length > 200) return undefined;
	return { lastSeen, person };
}

/** What to call a person: their email or name when they have one, otherwise their id. */
export function personName(person: string, properties: Record<string, unknown>): string {
	for (const key of ['email', '$email', 'name', '$name', 'username']) {
		const value = properties[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return person;
}

export function personHref(projectId: string, person: string): string {
	return `/projects/${projectId}/persons/${encodeURIComponent(person)}`;
}
