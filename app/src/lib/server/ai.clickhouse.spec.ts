// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiOverview, listTraces, scoreNames, traceEvents, traceScores } from './ai';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';

const project = 'abababab-abab-4bab-8bab-abababababab';
const other = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
const now = new Date(Date.UTC(2026, 9, 16, 12, 0));

const ai = (
	event: string,
	distinctId: string,
	ago: number,
	properties: Record<string, unknown>,
	projectId = project
): TestEvent => ({ projectId, distinctId, event, minutesAgo: ago, properties });

const generation = (
	trace: string,
	span: string,
	parent: string | undefined,
	model: string,
	cost: number,
	extra: Record<string, unknown> = {}
) => ({
	$ai_trace_id: trace,
	$ai_span_id: span,
	...(parent ? { $ai_parent_id: parent } : {}),
	$ai_model: model,
	$ai_provider: model.startsWith('gpt') ? 'openai' : 'anthropic',
	$ai_input_tokens: 1000,
	$ai_output_tokens: 100,
	$ai_latency: 1.5,
	$ai_cost_usd: cost,
	...extra
});

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('AI observability', () => {
	beforeAll(async () => {
		config = await createTestDatabase('ai');
		await insertEvents(
			config,
			[
				// Ada's trace: a trace event, a span, and two generations under it.
				ai('$ai_trace', 'ada', 60, {
					$ai_trace_id: 't1',
					$ai_span_id: 'root',
					$ai_span_name: 'answer',
					$ai_latency: 4
				}),
				ai('$ai_span', 'ada', 60, {
					$ai_trace_id: 't1',
					$ai_span_id: 's1',
					$ai_parent_id: 'root',
					$ai_span_name: 'retrieve',
					$ai_latency: 0.5
				}),
				ai('$ai_generation', 'ada', 59, generation('t1', 'g1', 'root', 'claude-sonnet-4-5', 0.01)),
				ai(
					'$ai_generation',
					'ada',
					59,
					generation('t1', 'g2', 'root', 'gpt-4o', 0.002, {
						$ai_is_error: true,
						$ai_error: 'rate limited'
					})
				),
				// A server call without a person, and a trace from yesterday.
				ai('$ai_generation', '$server', 30, generation('t2', 'g3', undefined, 'gpt-4o', 0.003)),
				ai('$ai_embedding', 'otel:worker', 20, {
					$ai_trace_id: 't3',
					$ai_span_id: 'e1',
					$ai_model: 'text-embedding-3-small',
					$ai_input_tokens: 50,
					$ai_cost_usd: 1
				}),
				ai('$ai_generation', 'bob', 26 * 60, generation('t4', 'g4', undefined, 'gpt-4o', 5)),
				// Scores: a thumbs down on Ada's gpt-4o call and an accuracy on her whole trace, a
				// thumbs up on the server call, and ones without a value or trace that don't count.
				ai('$ai_score', 'ada', 50, {
					$ai_trace_id: 't1',
					$ai_span_id: 'g2',
					$ai_score_name: 'thumbs',
					$ai_score_value: 0,
					$ai_score_comment: 'Wrong answer'
				}),
				ai('$ai_score', 'ada', 49, {
					$ai_trace_id: 't1',
					$ai_score_name: 'accuracy',
					$ai_score_value: 0.5
				}),
				ai('$ai_score', 'ada', 48, {
					$ai_trace_id: 't1',
					$ai_score_name: 'accuracy',
					$ai_score_value: 1
				}),
				ai('$ai_score', 'ada', 25, {
					$ai_trace_id: 't2',
					$ai_score_name: 'thumbs',
					$ai_score_value: 1
				}),
				ai('$ai_score', 'ada', 24, { $ai_trace_id: 't2', $ai_score_name: 'thumbs' }),
				ai('$ai_score', 'ada', 24, { $ai_score_name: 'thumbs', $ai_score_value: 1 }),
				// Another project.
				ai('$ai_generation', 'ada', 10, generation('t5', 'g5', undefined, 'gpt-4o', 7), other),
				ai(
					'$ai_score',
					'ada',
					9,
					{ $ai_trace_id: 't5', $ai_score_name: 'thumbs', $ai_score_value: 0 },
					other
				),
				// Not an AI event.
				{ projectId: project, distinctId: 'ada', event: '$pageview', minutesAgo: 5 }
			],
			now.getTime()
		);
	});

	afterAll(async () => {
		await dropTestDatabase(config);
	});

	it('totals cost and tokens by model and person', async () => {
		const overview = await aiOverview(config, project, { range: '24h', now });
		expect(overview.totals).toMatchObject({
			calls: 4,
			traces: 3,
			people: 1,
			inputTokens: 3050,
			outputTokens: 300,
			errors: 1
		});
		expect(overview.totals.cost).toBeCloseTo(1.015);
		expect(overview.totals.avgLatency).toBeCloseTo(1.5 * (3 / 4));
		expect(overview.cost.reduce((a, b) => a + b, 0)).toBeCloseTo(1.015);
		expect(overview.calls.reduce((a, b) => a + b, 0)).toBe(4);

		expect(overview.models.map((m) => [m.model, m.calls])).toEqual([
			['text-embedding-3-small', 1],
			['claude-sonnet-4-5', 1],
			['gpt-4o', 2]
		]);
		expect(overview.models.find((m) => m.model === 'gpt-4o')).toMatchObject({
			provider: 'openai',
			inputTokens: 2000,
			errors: 1
		});
		expect(overview.people).toEqual([
			expect.objectContaining({ person: 'ada', calls: 2, traces: 1 })
		]);
	});

	it('averages scores by name over time and by model', async () => {
		const overview = await aiOverview(config, project, { range: '24h', now });
		expect(overview.scores.map(({ name, count, avg }) => [name, count, avg])).toEqual([
			['accuracy', 2, 0.75],
			['thumbs', 2, 0.5]
		]);
		const accuracy = overview.scores[0];
		expect(accuracy?.series).toHaveLength(overview.buckets.length);
		expect(accuracy?.series.filter((v) => v !== null)).toEqual([0.75]);
		// The thumbs down was for gpt-4o only; the trace's accuracy counts for both its models.
		expect(
			overview.modelScores.map(({ model, name, count, avg }) => [model, name, count, avg])
		).toEqual([
			['claude-sonnet-4-5', 'accuracy', 2, 0.75],
			['gpt-4o', 'accuracy', 2, 0.75],
			['gpt-4o', 'thumbs', 2, 0.5]
		]);
	});

	it('shows and filters traces by their scores', async () => {
		const traces = await listTraces(config, project, { range: '24h', now });
		expect(traces.find((t) => t.traceId === 't1')?.scores).toEqual([
			{ name: 'accuracy', avg: 0.75, count: 2 },
			{ name: 'thumbs', avg: 0, count: 1 }
		]);
		expect(traces.find((t) => t.traceId === 't3')?.scores).toEqual([]);

		const ids = async (filter: Parameters<typeof listTraces>[2]) =>
			(await listTraces(config, project, filter)).map((t) => t.traceId);
		expect(await ids({ range: '24h', now, negative: true })).toEqual(['t1']);
		expect(await ids({ range: '24h', now, score: 'thumbs' })).toEqual(['t2', 't1']);
		expect(await ids({ range: '24h', now, score: 'thumbs', min: 1 })).toEqual(['t2']);
		expect(await ids({ range: '24h', now, score: 'accuracy', max: 0.5 })).toEqual([]);
		expect(await ids({ range: '24h', now, max: 0.5 })).toEqual(['t1']);
		expect(await scoreNames(config, project, { range: '24h', now })).toEqual([
			'accuracy',
			'thumbs'
		]);
	});

	it('loads one trace’s scores', async () => {
		const scores = await traceScores(config, project, 't1');
		expect(
			scores.map(({ spanId, name, value, comment }) => [spanId, name, value, comment])
		).toEqual([
			['g2', 'thumbs', 0, 'Wrong answer'],
			[null, 'accuracy', 0.5, null],
			[null, 'accuracy', 1, null]
		]);
		expect(scores[0]?.person).toBe('ada');
		expect(await traceScores(config, project, 't5')).toEqual([]);
	});

	it('lists traces with their name, person and totals', async () => {
		const traces = await listTraces(config, project, { range: '24h', now });
		expect(traces.map((t) => t.traceId)).toEqual(['t3', 't2', 't1']);
		const answer = traces.find((t) => t.traceId === 't1');
		expect(answer).toMatchObject({
			name: 'answer',
			person: 'ada',
			calls: 2,
			inputTokens: 2000,
			errors: 1,
			duration: 61.5
		});
		expect(answer?.cost).toBeCloseTo(0.012);
		expect(traces.find((t) => t.traceId === 't2')?.name).toBe('gpt-4o');

		const adas = await listTraces(config, project, { range: '7d', now, person: 'ada' });
		expect(adas.map((t) => t.traceId)).toEqual(['t1']);
	});

	it('loads one trace’s events', async () => {
		const events = await traceEvents(config, project, 't1');
		expect(events.map((e) => e.properties.$ai_span_id)).toEqual(['root', 's1', 'g1', 'g2']);
		expect(events[2]).toMatchObject({ event: '$ai_generation', person: 'ada' });
		expect(await traceEvents(config, project, 't5')).toEqual([]);
	});
});
