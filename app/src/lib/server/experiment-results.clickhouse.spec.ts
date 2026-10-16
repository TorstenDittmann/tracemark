// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { experimentCounts } from './experiment-results';

const project = 'abababab-abab-4bab-8bab-abababababab';
const now = new Date(Date.UTC(2026, 9, 16, 12, 0));
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const exposure = (
	distinctId: string,
	response: unknown,
	ago: number,
	flag = 'pricing'
): TestEvent => ({
	projectId: project,
	distinctId,
	event: '$feature_flag_called',
	minutesAgo: ago,
	properties: { $feature_flag: flag, $feature_flag_response: response }
});
const event = (distinctId: string, name: string, ago: number): TestEvent => ({
	projectId: project,
	distinctId,
	event: name,
	minutesAgo: ago
});

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('experiment results', () => {
	beforeAll(async () => {
		config = await createTestDatabase('experiments');
		await insertEvents(
			config,
			[
				// ada: control, buys twice after exposure, once before (not counted).
				event('ada', 'purchase', 100),
				exposure('ada', 'control', 90),
				event('ada', 'purchase', 80),
				event('ada', 'purchase', 70),
				// bob: test as an anonymous id, identified later; buys under the new id.
				exposure('anon-bob', 'test', 90),
				{
					projectId: project,
					distinctId: 'bob',
					event: '$identify',
					minutesAgo: 85,
					properties: { $anon_distinct_id: 'anon-bob' }
				},
				event('bob', 'purchase', 60),
				// cy: test, never buys; a later control answer doesn't move them.
				exposure('cy', 'test', 50),
				exposure('cy', 'control', 40),
				// dee: first served false, so not in the experiment.
				exposure('dee', false, 50),
				exposure('dee', 'test', 45),
				event('dee', 'purchase', 44),
				// eve: control, but exposed before the experiment started.
				exposure('eve', 'control', 200),
				// fay: another flag entirely.
				exposure('fay', 'test', 50, 'other')
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('counts exposed people and what they did afterwards', async () => {
		const results = await experimentCounts(config, project, {
			flag: 'pricing',
			variants: ['control', 'test', 'unused'],
			metrics: [
				{ kind: 'conversion', event: 'purchase' },
				{ kind: 'count', event: 'purchase' }
			],
			from: minutesAgo(120),
			to: now
		});
		expect(results).toEqual([
			{ variant: 'control', people: 1, values: [1, 2] },
			{ variant: 'test', people: 2, values: [1, 1] },
			{ variant: 'unused', people: 0, values: [0, 0] }
		]);
	});

	it('stops counting at the end of the window', async () => {
		const results = await experimentCounts(config, project, {
			flag: 'pricing',
			variants: ['control', 'test'],
			metrics: [{ kind: 'count', event: 'purchase' }],
			from: minutesAgo(120),
			to: minutesAgo(75)
		});
		expect(results).toEqual([
			{ variant: 'control', people: 1, values: [1] },
			{ variant: 'test', people: 1, values: [0] }
		]);
	});

	it('works without metrics', async () => {
		const results = await experimentCounts(config, project, {
			flag: 'pricing',
			variants: ['control', 'test'],
			metrics: [],
			from: minutesAgo(120),
			to: now
		});
		expect(results).toEqual([
			{ variant: 'control', people: 1, values: [] },
			{ variant: 'test', people: 2, values: [] }
		]);
	});
});
