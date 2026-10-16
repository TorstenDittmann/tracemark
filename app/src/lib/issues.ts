// Error issues: `$exception` events grouped by the fingerprint ingest gives them (see
// docs/errors.md), with a triage status kept in libSQL.

export type IssueStatus = 'open' | 'resolved' | 'ignored';

export const STATUSES: Record<IssueStatus, string> = {
	open: 'Open',
	resolved: 'Resolved',
	ignored: 'Ignored'
};

export function parseStatus(value: string | null): IssueStatus {
	return value && Object.hasOwn(STATUSES, value) ? (value as IssueStatus) : 'open';
}

export const issuesHref = (projectId: string) => `/projects/${projectId}/issues`;
export const issueHref = (projectId: string, fingerprint: string) =>
	`/projects/${projectId}/issues/${encodeURIComponent(fingerprint)}`;

/** Fingerprints are 16 hex characters from ingest, or whatever a client sent, kept short. */
export const validFingerprint = (value: string) => value.length > 0 && value.length <= 200;

/**
 * The status to show. A resolved issue that happened again after it was resolved is open again
 * (a regression); an ignored one stays ignored whatever happens.
 */
export function currentStatus(
	stored: { status: IssueStatus; statusChangedAt: Date } | undefined,
	lastSeen: Date
): { status: IssueStatus; regressed: boolean } {
	if (!stored) return { status: 'open', regressed: false };
	if (stored.status === 'resolved' && lastSeen > stored.statusChangedAt) {
		return { status: 'open', regressed: true };
	}
	return { status: stored.status, regressed: false };
}

export interface StackFrame {
	filename: string;
	function: string;
	lineno?: number;
	colno?: number;
	inApp: boolean;
}

export interface ExceptionEntry {
	type: string;
	value: string;
	handled?: boolean;
	mechanism?: string;
	/** Innermost frame first, as sent. */
	frames: StackFrame[];
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const int = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

/** Reads a stored `$exception_list`; malformed fields read as empty rather than trusted. */
export function parseExceptionList(value: unknown): ExceptionEntry[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => {
		const entry = record(item);
		const mechanism = record(entry.mechanism);
		const frames = record(entry.stacktrace).frames;
		return {
			type: str(entry.type) || 'Error',
			value: str(entry.value),
			handled: typeof mechanism.handled === 'boolean' ? mechanism.handled : undefined,
			mechanism: str(mechanism.type) || undefined,
			frames: (Array.isArray(frames) ? frames : []).map((frame) => {
				const f = record(frame);
				return {
					filename: str(f.filename),
					function: str(f.function),
					lineno: int(f.lineno),
					colno: int(f.colno),
					inApp: f.in_app === true
				};
			})
		};
	});
}

/** `file:line:col`, leaving out what is unknown. */
export function frameLocation(frame: StackFrame): string {
	return [frame.filename || '<unknown>', frame.lineno, frame.colno]
		.filter((part) => part !== undefined)
		.join(':');
}
