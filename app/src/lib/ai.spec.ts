import { describe, expect, it } from 'vitest';
import {
	type AiEvent,
	asMessages,
	buildTree,
	flatten,
	formatCost,
	formatDuration,
	formatTokens
} from './ai';

let n = 0;
function event(name: string, at: number, properties: Record<string, unknown>): AiEvent {
	n += 1;
	return {
		uuid: `u${n}`,
		event: name,
		timestamp: new Date(Date.UTC(2026, 9, 16, 12, 0, 0, at)).toISOString(),
		person: 'ada',
		properties
	};
}

describe('trace trees', () => {
	it('nests events under their parents, rolling up cost', () => {
		const roots = buildTree([
			event('$ai_generation', 300, {
				$ai_span_id: 'g2',
				$ai_parent_id: 's1',
				$ai_model: 'gpt-4o',
				$ai_cost_usd: 0.25,
				$ai_latency: 0.2
			}),
			event('$ai_trace', 0, { $ai_span_id: 'root', $ai_span_name: 'answer', $ai_latency: 1 }),
			event('$ai_span', 100, { $ai_span_id: 's1', $ai_parent_id: 'root', $ai_span_name: 'plan' }),
			event('$ai_generation', 200, {
				$ai_span_id: 'g1',
				$ai_parent_id: 'root',
				$ai_model: 'claude-sonnet-4-5',
				$ai_cost_usd: 0.5,
				$ai_is_error: true,
				$ai_error: 'overloaded'
			}),
			event('$ai_generation', 400, { $ai_span_id: 'g3', $ai_parent_id: 'gone', $ai_cost_usd: 1 })
		]);
		expect(roots).toHaveLength(1);
		const rows = flatten(roots).map(({ node, depth }) => [node.name, depth, node.offset]);
		expect(rows).toEqual([
			['answer', 0, 0],
			['plan', 1, 100],
			['gpt-4o', 2, 300],
			['claude-sonnet-4-5', 1, 200],
			['generation', 1, 400]
		]);
		const [root] = roots;
		expect(root?.cost).toBeCloseTo(1.75);
		expect(root?.duration).toBe(1000);
		expect(root?.children[0]?.cost).toBeCloseTo(0.25);
		expect(root?.children[1]).toMatchObject({ kind: 'generation', error: 'overloaded' });
	});

	it('keeps several roots without a trace event and survives cycles', () => {
		const roots = buildTree([
			event('$ai_span', 0, { $ai_span_id: 'a', $ai_parent_id: 'b' }),
			event('$ai_span', 10, { $ai_span_id: 'b', $ai_parent_id: 'a' }),
			event('$ai_generation', 20, { $ai_model: 'gpt-4o' })
		]);
		expect(flatten(roots).length).toBe(3);
		expect(buildTree([])).toEqual([]);
	});
});

describe('formatting', () => {
	it('formats costs, tokens and durations', () => {
		expect(formatCost(0)).toBe('$0');
		expect(formatCost(0.000213)).toBe('$0.00021');
		expect(formatCost(0.0035)).toBe('$0.0035');
		expect(formatCost(12.5)).toBe('$12.50');
		expect(formatTokens(1234)).toBe('1,234');
		expect(formatTokens(1_250_000)).toBe('1.3M');
		expect(formatDuration(0.85)).toBe('850 ms');
		expect(formatDuration(2.44)).toBe('2.4 s');
		expect(formatDuration(185)).toBe('3m 05s');
		expect(formatDuration(59.96)).toBe('1m 00s');
		expect(formatDuration(119.6)).toBe('2m 00s');
	});

	it('reads messages from every provider’s shape', () => {
		expect(asMessages('Hi')).toEqual([{ role: 'user', parts: [{ kind: 'text', value: 'Hi' }] }]);
		expect(
			asMessages([
				{ role: 'system', content: 'Be brief.' },
				{ role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
				{
					role: 'assistant',
					content: [{ type: 'tool_use', name: 'weather', input: { city: 'Berlin' } }]
				},
				{ role: 'assistant', content: null, tool_calls: [{ id: 'c1' }] }
			])
		).toEqual([
			{ role: 'system', parts: [{ kind: 'text', value: 'Be brief.' }] },
			{ role: 'user', parts: [{ kind: 'text', value: 'Weather?' }] },
			{
				role: 'assistant',
				parts: [
					{
						kind: 'json',
						value: JSON.stringify(
							{ type: 'tool_use', name: 'weather', input: { city: 'Berlin' } },
							null,
							2
						)
					}
				]
			},
			{
				role: 'assistant',
				parts: [{ kind: 'json', value: JSON.stringify({ tool_calls: [{ id: 'c1' }] }, null, 2) }]
			}
		]);
		expect(asMessages([{ type: 'message' }])).toBeNull();
		expect(asMessages({ prompt: 'x' })).toBeNull();
		expect(asMessages([])).toBeNull();
	});
});
