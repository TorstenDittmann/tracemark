import { describe, expect, it } from 'vitest';
import { currentStatus, frameLocation, parseExceptionList, parseStatus } from './issues';

describe('issue status', () => {
	const resolvedAt = new Date('2026-10-10T00:00:00Z');

	it('is open until someone triages it', () => {
		expect(currentStatus(undefined, resolvedAt)).toEqual({ status: 'open', regressed: false });
	});

	it('reopens a resolved issue that happened again', () => {
		const stored = { status: 'resolved' as const, statusChangedAt: resolvedAt };
		expect(currentStatus(stored, new Date('2026-10-09T00:00:00Z'))).toEqual({
			status: 'resolved',
			regressed: false
		});
		expect(currentStatus(stored, new Date('2026-10-11T00:00:00Z'))).toEqual({
			status: 'open',
			regressed: true
		});
	});

	it('keeps an ignored issue ignored', () => {
		const stored = { status: 'ignored' as const, statusChangedAt: resolvedAt };
		expect(currentStatus(stored, new Date('2026-10-11T00:00:00Z')).status).toBe('ignored');
	});

	it('parses the status filter', () => {
		expect(parseStatus('resolved')).toBe('resolved');
		expect(parseStatus('constructor')).toBe('open');
		expect(parseStatus(null)).toBe('open');
	});
});

describe('exception lists', () => {
	it('reads frames and skips what is malformed', () => {
		expect(
			parseExceptionList([
				{
					type: 'TypeError',
					value: 'boom',
					mechanism: { type: 'onerror', handled: true },
					stacktrace: {
						frames: [
							{ filename: 'app.js', function: 'f', lineno: 1, colno: 2, in_app: true },
							{ filename: 7, lineno: 'x' },
							null
						]
					}
				},
				'nonsense'
			])
		).toEqual([
			{
				type: 'TypeError',
				value: 'boom',
				handled: true,
				mechanism: 'onerror',
				frames: [
					{ filename: 'app.js', function: 'f', lineno: 1, colno: 2, inApp: true },
					{ filename: '', function: '', lineno: undefined, colno: undefined, inApp: false },
					{ filename: '', function: '', lineno: undefined, colno: undefined, inApp: false }
				]
			},
			{ type: 'Error', value: '', handled: undefined, mechanism: undefined, frames: [] }
		]);
		expect(parseExceptionList({ type: 'x' })).toEqual([]);
	});

	it('formats a frame location', () => {
		expect(
			frameLocation({ filename: 'a.js', function: '', lineno: 3, colno: 4, inApp: true })
		).toBe('a.js:3:4');
		expect(frameLocation({ filename: '', function: '', inApp: false })).toBe('<unknown>');
	});
});
