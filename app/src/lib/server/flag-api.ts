// Request parsing for the public flags API, see docs/flags-api.md.
import type { FlagResult } from '@footprint/flags';
import type { FlagRequest } from './flag-evaluation';

export const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROPERTIES = 200;
const MAX_GROUPS = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 200;

function properties(value: unknown, field: string): Record<string, unknown> | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error(`${field} must be an object`);
	if (Object.keys(value).length > MAX_PROPERTIES) {
		throw new Error(`${field} has more than ${MAX_PROPERTIES} properties`);
	}
	return value;
}

/** The project key and flag request in a `POST /flags` body. Throws with a message for a 400. */
export function parseFlagsBody(body: unknown): { apiKey: string; request: FlagRequest } {
	if (!isRecord(body)) throw new Error('body must be a JSON object');
	if (typeof body.api_key !== 'string' || !body.api_key) throw new Error('api_key is required');
	if (!isId(body.distinct_id)) throw new Error('distinct_id must be 1 to 200 characters');
	const request: FlagRequest = { distinctId: body.distinct_id };
	const personProperties = properties(body.person_properties, 'person_properties');
	if (personProperties) request.personProperties = personProperties;

	if (body.groups !== undefined && body.groups !== null) {
		if (!isRecord(body.groups)) throw new Error('groups must be an object');
		const entries = Object.entries(body.groups);
		if (entries.length > MAX_GROUPS) throw new Error(`at most ${MAX_GROUPS} groups`);
		request.groups = {};
		for (const [type, key] of entries) {
			if (!isId(type) || !isId(key)) throw new Error('groups maps group types to group keys');
			request.groups[type] = key;
		}
	}
	if (body.group_properties !== undefined && body.group_properties !== null) {
		if (!isRecord(body.group_properties)) throw new Error('group_properties must be an object');
		request.groupProperties = {};
		for (const [type, value] of Object.entries(body.group_properties)) {
			if (!request.groups?.[type]) continue;
			const props = properties(value, `group_properties.${type}`);
			if (props) request.groupProperties[type] = props;
		}
	}
	return { apiKey: body.api_key, request };
}

/** The response body: each flag's value, and the payloads of flags that are on. */
export function flagsResponse(results: Record<string, FlagResult>) {
	const flags: Record<string, boolean | string> = {};
	const payloads: Record<string, unknown> = {};
	for (const [key, result] of Object.entries(results)) {
		flags[key] = result.value;
		if (result.payload !== null && result.payload !== undefined) payloads[key] = result.payload;
	}
	return { flags, payloads };
}
