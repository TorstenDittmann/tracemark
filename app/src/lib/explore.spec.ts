import { describe, expect, it } from 'vitest';
import {
	eventSummary,
	formatCursor,
	parseActivityParam,
	parseCursor,
	readableType
} from './explore';

describe('activity queries', () => {
	it('keeps a valid event and filters', () => {
		expect(
			parseActivityParam(
				JSON.stringify({
					event: 'purchase',
					filters: [{ property: 'plan', operator: 'eq', value: 'pro' }]
				})
			)
		).toEqual({ event: 'purchase', filters: [{ property: 'plan', operator: 'eq', value: 'pro' }] });
	});

	it('drops what it cannot use', () => {
		expect(parseActivityParam('{"event":"a`b","filters":"nope"}')).toEqual({ filters: [] });
		expect(parseActivityParam('not json')).toEqual({ filters: [] });
		expect(parseActivityParam(null)).toEqual({ filters: [] });
		expect(parseActivityParam('[]')).toEqual({ filters: [] });
	});
});

describe('activity cursors', () => {
	const cursor = {
		timestamp: '2026-10-16T12:00:00.000Z',
		uuid: '00000000-0000-4000-8000-000000000001'
	};

	it('round-trips', () => {
		expect(parseCursor(formatCursor(cursor))).toEqual(cursor);
	});

	it('ignores malformed values', () => {
		expect(parseCursor(null)).toBeUndefined();
		expect(parseCursor('2026-10-16')).toBeUndefined();
		expect(parseCursor(`2026-10-16T12:00:00Z_not-a-uuid`)).toBeUndefined();
		expect(parseCursor(`${formatCursor(cursor)}_extra`)).toBeUndefined();
	});
});

describe('readable types', () => {
	it('names ClickHouse JSON types', () => {
		expect(readableType('Int64')).toBe('number');
		expect(readableType('Float64')).toBe('number');
		expect(readableType('Bool')).toBe('boolean');
		expect(readableType('String')).toBe('string');
		expect(readableType('Array(Nullable(String))')).toBe('list');
		expect(readableType('DateTime64(9)')).toBe('date');
	});
});

describe('event summaries', () => {
	it('describes autocaptured clicks and submits', () => {
		expect(eventSummary('$autocapture', { $event_type: 'click', $el_text: 'Sign up' })).toBe(
			"clicked 'Sign up'"
		);
		expect(eventSummary('$autocapture', { $event_type: 'click', $el_tag: 'a' })).toBe(
			'clicked a link'
		);
		expect(eventSummary('$autocapture', { $event_type: 'submit', $el_tag: 'form' })).toBe(
			'submitted a form'
		);
		expect(eventSummary('$autocapture', { $event_type: 'click', $el_tag: 'div' })).toBe(
			'clicked div'
		);
		expect(eventSummary('$autocapture', {})).toBe('clicked');
	});

	it('keeps other event names', () => {
		expect(eventSummary('signed_up', { $el_text: 'x' })).toBe('signed_up');
	});
});
