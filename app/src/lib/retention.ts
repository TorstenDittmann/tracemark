// How long a project keeps its events. Shared by the settings page and the server.

/** The retention periods offered, in days. */
export const RETENTION_DAYS = [30, 90, 180, 365, 730, 1825] as const;

export function retentionLabel(days: number | null): string {
	if (days === null) return 'Keep forever';
	if (days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`;
	return `${days} days`;
}

/** A form value as a retention period: days, null for forever, or undefined when invalid. */
export function parseRetention(value: unknown): number | null | undefined {
	if (value === 'forever') return null;
	const days = Number(value);
	return (RETENTION_DAYS as readonly number[]).includes(days) ? days : undefined;
}
