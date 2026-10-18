import { describe, expect, it } from 'vitest';
import { make, mockFetch, sentEvents } from './helpers';

describe('aiScore', () => {
	it('sends a $ai_score event for the current person', async () => {
		const f = mockFetch();
		const c = make();
		c.identify('ada');
		c.aiScore({ traceId: 't1', name: 'thumbs', value: 1 });
		c.aiScore({ traceId: 't1', spanId: 'g1', name: 'helpful', value: 0, comment: 'Off topic' });
		await c.flush();
		const scores = sentEvents(f).filter((e) => e.event === '$ai_score');
		expect(scores.map((e) => e.distinct_id)).toEqual(['ada', 'ada']);
		expect(scores[0]?.properties).toMatchObject({
			$ai_trace_id: 't1',
			$ai_score_name: 'thumbs',
			$ai_score_value: 1
		});
		expect(scores[0]?.properties).not.toHaveProperty('$ai_score_comment');
		expect(scores[1]?.properties).toMatchObject({
			$ai_span_id: 'g1',
			$ai_score_value: 0,
			$ai_score_comment: 'Off topic'
		});
	});
});
