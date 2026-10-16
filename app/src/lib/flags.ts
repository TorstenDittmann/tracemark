import type { FlagDefinition } from '@footprint/flags';

export const MAX_PAYLOAD_BYTES = 10_000;
export const MAX_DESCRIPTION = 500;

export const flagsHref = (projectId: string) => `/projects/${projectId}/flags`;
export const flagHref = (projectId: string, flagId: string) =>
	`/projects/${projectId}/flags/${flagId}`;

/** A one-line description of who gets a flag, for lists. */
export function flagSummary(flag: FlagDefinition): string {
	if (!flag.conditions.length) return 'Nobody';
	if (flag.conditions.length > 1) return `${flag.conditions.length} conditions`;
	const [condition] = flag.conditions;
	if (!condition) return 'Nobody';
	const who = condition.filters.length
		? `${condition.rollout}% of matching ${flag.groupType ? 'groups' : 'people'}`
		: `${condition.rollout}% of ${flag.groupType ? 'groups' : 'everyone'}`;
	return condition.rollout === 0 ? 'Nobody' : who;
}

/** The kind of a flag, for lists. */
export function flagKind(flag: FlagDefinition): string {
	const count = flag.variants.length;
	if (!count) return 'Boolean';
	return count === 1 ? '1 variant' : `${count} variants`;
}

/**
 * Parses payload text from the editor into values keyed like `FlagDefinition.payloads`.
 * Empty text means no payload. Throws with a readable message.
 */
export function parsePayloads(texts: Record<string, string>): Record<string, unknown> {
	const payloads: Record<string, unknown> = {};
	for (const [key, text] of Object.entries(texts)) {
		if (!text.trim()) continue;
		if (text.length > MAX_PAYLOAD_BYTES) {
			throw new Error(`The payload for ${key} is over ${MAX_PAYLOAD_BYTES / 1000} KB.`);
		}
		try {
			payloads[key] = JSON.parse(text);
		} catch {
			throw new Error(`The payload for ${key} isn't valid JSON.`);
		}
	}
	return payloads;
}

/** Splits 100% evenly across `count` variants, giving any remainder to the first ones. */
export function evenSplit(count: number): number[] {
	const base = Math.floor(100 / count);
	return Array.from({ length: count }, (_, i) => base + (i < 100 - base * count ? 1 : 0));
}
