import Anthropic from '@anthropic-ai/sdk';
import { generateText, streamText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import OpenAI from 'openai';
import { afterEach, describe, expect, it } from 'vitest';
import { Tracemark } from '../src';
import { createAi } from '../src/ai';

const HOST = 'https://tracemark.example.com';
type Event = { event: string; distinct_id: string; properties: Record<string, unknown> };

const clients: Tracemark[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((c) => c.shutdown()));
});

function tracemark() {
	const events: Event[] = [];
	const client = new Tracemark({
		apiKey: 'fp_pub_test',
		host: HOST,
		fetch: (async (_url: string, init: RequestInit = {}) => {
			events.push(...JSON.parse(String(init.body)).batch);
			return Response.json({}, { status: 202 });
		}) as typeof fetch
	});
	clients.push(client);
	return {
		client,
		events,
		async sent(name?: string) {
			await client.flush();
			return name ? events.filter((e) => e.event === name) : events;
		}
	};
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function sse(events: unknown[], named = false) {
	const text = events
		.map((e) => {
			const data = `data: ${JSON.stringify(e)}\n\n`;
			return named ? `event: ${(e as { type: string }).type}\n${data}` : data;
		})
		.join('');
	return new Response(`${text}${named ? '' : 'data: [DONE]\n\n'}`, {
		headers: { 'content-type': 'text/event-stream' }
	});
}

/** A provider API that answers with `respond` and keeps the request bodies. */
function provider(respond: (body: Record<string, unknown>, url: string) => Response) {
	const requests: Record<string, unknown>[] = [];
	const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
		const body = JSON.parse(String(init.body ?? '{}'));
		requests.push(body);
		return respond(body, String(url));
	};
	return { fetch: fetch as typeof globalThis.fetch, requests };
}

const message = {
	id: 'msg_1',
	type: 'message',
	role: 'assistant',
	model: 'claude-sonnet-4-5-20250929',
	content: [{ type: 'text', text: 'Hello!' }],
	stop_reason: 'end_turn',
	usage: {
		input_tokens: 10,
		output_tokens: 5,
		cache_read_input_tokens: 100,
		cache_creation_input_tokens: 20
	}
};

const anthropicStream = [
	{
		type: 'message_start',
		message: { ...message, content: [], usage: { input_tokens: 10, output_tokens: 1 } }
	},
	{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
	{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo!' } },
	{ type: 'content_block_stop', index: 0 },
	{
		type: 'content_block_start',
		index: 1,
		content_block: { type: 'tool_use', id: 't1', name: 'weather', input: {} }
	},
	{
		type: 'content_block_delta',
		index: 1,
		delta: { type: 'input_json_delta', partial_json: '{"city":' }
	},
	{
		type: 'content_block_delta',
		index: 1,
		delta: { type: 'input_json_delta', partial_json: '"Berlin"}' }
	},
	{ type: 'content_block_stop', index: 1 },
	{ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
	{ type: 'message_stop' }
];

describe('Anthropic', () => {
	function anthropic(respond: Parameters<typeof provider>[0]) {
		const api = provider(respond);
		const fp = tracemark();
		const ai = createAi(fp.client, { properties: { app: 'docs' } });
		const client = ai.wrapAnthropic(
			new Anthropic({ apiKey: 'sk-test', fetch: api.fetch, maxRetries: 0 })
		);
		return { ...fp, ai, client, requests: api.requests };
	}

	it('records a call and returns the response unchanged', async () => {
		const { client, sent } = anthropic(() => json(message));
		const response = await client.messages.create({
			model: 'claude-sonnet-4-5',
			max_tokens: 100,
			temperature: 0.2,
			system: 'Be brief.',
			messages: [{ role: 'user', content: 'Hi' }]
		});
		expect(response.content).toEqual(message.content);

		const [event] = await sent('$ai_generation');
		expect(event?.distinct_id).toBe('$server');
		expect(event?.properties).toMatchObject({
			$ai_provider: 'anthropic',
			$ai_model: 'claude-sonnet-4-5-20250929',
			$ai_input: [
				{ role: 'system', content: 'Be brief.' },
				{ role: 'user', content: 'Hi' }
			],
			$ai_output_choices: [{ role: 'assistant', content: message.content }],
			$ai_input_tokens: 130,
			$ai_output_tokens: 5,
			$ai_cache_read_input_tokens: 100,
			$ai_cache_creation_input_tokens: 20,
			$ai_temperature: 0.2,
			$ai_max_tokens: 100,
			$ai_stream: false,
			app: 'docs'
		});
		expect(event?.properties.$ai_trace_id).toBe(event?.properties.$ai_span_id);
		expect(event?.properties.$ai_latency).toEqual(expect.any(Number));
	});

	it('keeps withResponse() and records streams as they are read', async () => {
		const { client, sent } = anthropic(() => sse(anthropicStream, true));
		const { data: stream, response } = await client.messages
			.create({
				model: 'claude-sonnet-4-5',
				max_tokens: 100,
				stream: true,
				messages: [{ role: 'user', content: 'Weather?' }]
			})
			.withResponse();
		expect(response.status).toBe(200);
		expect(await sent('$ai_generation')).toEqual([]);
		const types: string[] = [];
		for await (const event of stream) types.push(event.type);
		expect(types).toContain('message_stop');

		const [event] = await sent('$ai_generation');
		expect(event?.properties).toMatchObject({
			$ai_stream: true,
			$ai_input_tokens: 10,
			$ai_output_tokens: 7,
			$ai_output_choices: [
				{
					role: 'assistant',
					content: [
						{ type: 'text', text: 'Hello!' },
						{ type: 'tool_use', id: 't1', name: 'weather', input: { city: 'Berlin' } }
					]
				}
			]
		});
	});

	it('records messages.stream()', async () => {
		const { client, sent } = anthropic(() => sse(anthropicStream, true));
		const final = await client.messages
			.stream({
				model: 'claude-sonnet-4-5',
				max_tokens: 100,
				messages: [{ role: 'user', content: 'Hi' }]
			})
			.finalMessage();
		expect(final.usage.output_tokens).toBe(7);
		const events = await sent('$ai_generation');
		expect(events).toHaveLength(1);
		expect(events[0]?.properties).toMatchObject({ $ai_stream: true, $ai_output_tokens: 7 });
	});

	it('records failed calls and rethrows', async () => {
		const { client, sent } = anthropic(() =>
			json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529)
		);
		await expect(
			client.messages.create({
				model: 'claude-sonnet-4-5',
				max_tokens: 10,
				messages: [{ role: 'user', content: 'Hi' }]
			})
		).rejects.toThrow(/Overloaded/);
		const [event] = await sent('$ai_generation');
		expect(event?.properties).toMatchObject({
			$ai_is_error: true,
			$ai_http_status: 529,
			$ai_model: 'claude-sonnet-4-5'
		});
		expect(event?.properties.$ai_error).toMatch(/Overloaded/);
	});

	it('groups calls into traces and spans for one person', async () => {
		const { ai, client, sent } = anthropic(() => json(message));
		const answer = await ai.trace(
			{ name: 'answer', distinctId: 'ada', input: { question: 'Hi?' } },
			async () => {
				const docs = await ai.span({ name: 'retrieve', input: 'Hi?' }, async () => ['doc']);
				await ai.span({ name: 'generate' }, () =>
					client.messages.create({
						model: 'claude-sonnet-4-5',
						max_tokens: 10,
						messages: [{ role: 'user', content: String(docs) }]
					})
				);
				return 'Hello!';
			}
		);
		expect(answer).toBe('Hello!');

		const events = await sent();
		const trace = events.find((e) => e.event === '$ai_trace');
		const retrieve = events.find((e) => e.properties.$ai_span_name === 'retrieve');
		const generate = events.find((e) => e.properties.$ai_span_name === 'generate');
		const generation = events.find((e) => e.event === '$ai_generation');
		expect(events.every((e) => e.distinct_id === 'ada')).toBe(true);
		const traceId = trace?.properties.$ai_trace_id;
		expect(events.every((e) => e.properties.$ai_trace_id === traceId)).toBe(true);
		expect(trace?.properties).toMatchObject({
			$ai_span_name: 'answer',
			$ai_input_state: { question: 'Hi?' },
			$ai_output_state: 'Hello!'
		});
		expect(trace?.properties.$ai_parent_id).toBeUndefined();
		expect(retrieve?.properties).toMatchObject({
			$ai_parent_id: trace?.properties.$ai_span_id,
			$ai_output_state: ['doc']
		});
		expect(generation?.properties.$ai_parent_id).toBe(generate?.properties.$ai_span_id);
	});

	it('leaves out content in privacy mode and records failed traces', async () => {
		const { ai, client, sent } = anthropic(() => json(message));
		await expect(
			ai.trace({ name: 'secret', input: 'card number', privacyMode: true }, async () => {
				await client.messages.create({
					model: 'claude-sonnet-4-5',
					max_tokens: 10,
					messages: [{ role: 'user', content: 'card number' }]
				});
				throw new Error('nope');
			})
		).rejects.toThrow('nope');
		const events = await sent();
		const text = JSON.stringify(events);
		expect(text).not.toContain('card number');
		expect(text).not.toContain('Hello!');
		expect(events.find((e) => e.event === '$ai_generation')?.properties.$ai_input_tokens).toBe(130);
		expect(events.find((e) => e.event === '$ai_trace')?.properties).toMatchObject({
			$ai_is_error: true,
			$ai_error: 'nope'
		});
	});
});

describe('OpenAI', () => {
	function openai(respond: Parameters<typeof provider>[0]) {
		const api = provider(respond);
		const fp = tracemark();
		const client = createAi(fp.client).wrapOpenAI(
			new OpenAI({ apiKey: 'sk-test', fetch: api.fetch, maxRetries: 0 })
		);
		return { ...fp, client, requests: api.requests };
	}

	const completion = {
		id: 'c1',
		object: 'chat.completion',
		created: 1,
		model: 'gpt-4o-2024-08-06',
		choices: [{ index: 0, message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }],
		usage: {
			prompt_tokens: 50,
			completion_tokens: 3,
			total_tokens: 53,
			prompt_tokens_details: { cached_tokens: 20 }
		}
	};

	it('records chat completions', async () => {
		const { client, sent } = openai(() => json(completion));
		const result = await client.chat.completions.create({
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Hello' }]
		});
		expect(result.choices[0]?.message.content).toBe('Hi!');
		const [event] = await sent('$ai_generation');
		expect(event?.properties).toMatchObject({
			$ai_provider: 'openai',
			$ai_model: 'gpt-4o-2024-08-06',
			$ai_input: [{ role: 'user', content: 'Hello' }],
			$ai_output_choices: [{ role: 'assistant', content: 'Hi!' }],
			$ai_input_tokens: 50,
			$ai_output_tokens: 3,
			$ai_cache_read_input_tokens: 20
		});
	});

	it('asks for usage on streams and records them', async () => {
		const chunk = (delta: unknown, extra: Record<string, unknown> = {}) => ({
			id: 'c1',
			object: 'chat.completion.chunk',
			created: 1,
			model: 'gpt-4o-2024-08-06',
			choices: delta ? [{ index: 0, delta, finish_reason: null }] : [],
			...extra
		});
		const { client, sent, requests } = openai(() =>
			sse([
				chunk({ role: 'assistant', content: 'Hel' }),
				chunk({ content: 'lo' }),
				chunk({
					tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '{"c' } }]
				}),
				chunk({ tool_calls: [{ index: 0, function: { arguments: 'ity":"Berlin"}' } }] }),
				chunk(null, { usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } })
			])
		);
		const stream = await client.chat.completions.create({
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Hello' }],
			stream: true
		});
		let text = '';
		for await (const part of stream) text += part.choices[0]?.delta.content ?? '';
		expect(text).toBe('Hello');
		expect(requests[0]?.stream_options).toEqual({ include_usage: true });

		const [event] = await sent('$ai_generation');
		expect(event?.properties).toMatchObject({
			$ai_stream: true,
			$ai_input_tokens: 9,
			$ai_output_tokens: 4,
			$ai_output_choices: [
				{
					role: 'assistant',
					content: 'Hello',
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'weather', arguments: '{"city":"Berlin"}' }
						}
					]
				}
			]
		});
	});

	it('records responses and embeddings', async () => {
		const { client, sent } = openai((_body, url) =>
			url.endsWith('/embeddings')
				? json({
						object: 'list',
						model: 'text-embedding-3-small',
						data: [{ object: 'embedding', index: 0, embedding: [0.1] }],
						usage: { prompt_tokens: 4, total_tokens: 4 }
					})
				: json({
						id: 'r1',
						object: 'response',
						created_at: 1,
						status: 'completed',
						model: 'gpt-5-mini',
						output: [
							{
								type: 'message',
								id: 'm1',
								role: 'assistant',
								status: 'completed',
								content: [{ type: 'output_text', text: 'Hi!', annotations: [] }]
							}
						],
						usage: {
							input_tokens: 30,
							output_tokens: 2,
							total_tokens: 32,
							input_tokens_details: { cached_tokens: 10 },
							output_tokens_details: { reasoning_tokens: 0 }
						}
					})
		);
		const response = await client.responses.create({
			model: 'gpt-5-mini',
			instructions: 'Be brief.',
			input: 'Hello'
		});
		expect(response.output_text).toBe('Hi!');
		await client.embeddings.create({ model: 'text-embedding-3-small', input: 'hello' });

		const [generation] = await sent('$ai_generation');
		expect(generation?.properties).toMatchObject({
			$ai_model: 'gpt-5-mini',
			$ai_input: [
				{ role: 'system', content: 'Be brief.' },
				{ role: 'user', content: 'Hello' }
			],
			$ai_input_tokens: 30,
			$ai_output_tokens: 2,
			$ai_cache_read_input_tokens: 10
		});
		const [embedding] = await sent('$ai_embedding');
		expect(embedding?.properties).toMatchObject({
			$ai_model: 'text-embedding-3-small',
			$ai_input: 'hello',
			$ai_input_tokens: 4
		});
	});
});

describe('Vercel AI SDK', () => {
	const usage = {
		inputTokens: { total: 40, noCache: 30, cacheRead: 10, cacheWrite: undefined },
		outputTokens: { total: 6, text: 6, reasoning: undefined }
	};

	function model() {
		const fp = tracemark();
		const ai = createAi(fp.client);
		const wrapped = wrapLanguageModel({
			model: new MockLanguageModelV4({
				provider: 'openai.chat',
				modelId: 'gpt-4o',
				doGenerate: async () => ({
					content: [{ type: 'text', text: 'Hi there' }],
					finishReason: { unified: 'stop', raw: 'stop' },
					usage,
					warnings: []
				}),
				doStream: async () => ({
					stream: new ReadableStream({
						start(controller) {
							controller.enqueue({ type: 'stream-start', warnings: [] });
							controller.enqueue({ type: 'response-metadata', modelId: 'gpt-4o-2024-08-06' });
							controller.enqueue({ type: 'text-start', id: '1' });
							controller.enqueue({ type: 'text-delta', id: '1', delta: 'Hi ' });
							controller.enqueue({ type: 'text-delta', id: '1', delta: 'there' });
							controller.enqueue({ type: 'text-end', id: '1' });
							controller.enqueue({
								type: 'finish',
								finishReason: { unified: 'stop', raw: 'stop' },
								usage
							});
							controller.close();
						}
					})
				})
			}),
			middleware: ai.middleware()
		});
		return { ...fp, ai, model: wrapped };
	}

	it('records generateText', async () => {
		const { model: m, sent } = model();
		const { text } = await generateText({ model: m, prompt: 'Hello' });
		expect(text).toBe('Hi there');
		const [event] = await sent('$ai_generation');
		expect(event?.properties).toMatchObject({
			$ai_provider: 'openai',
			$ai_model: 'gpt-4o',
			$ai_input_tokens: 40,
			$ai_output_tokens: 6,
			$ai_cache_read_input_tokens: 10,
			$ai_stream: false,
			$ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }]
		});
		expect(JSON.stringify(event?.properties.$ai_input)).toContain('Hello');
	});

	it('records streamText inside a trace', async () => {
		const { ai, model: m, sent } = model();
		await ai.trace({ name: 'chat', distinctId: 'ada' }, async () => {
			const result = streamText({ model: m, prompt: 'Hello' });
			expect(await result.text).toBe('Hi there');
		});
		const [event] = await sent('$ai_generation');
		expect(event?.distinct_id).toBe('ada');
		expect(event?.properties).toMatchObject({
			$ai_model: 'gpt-4o-2024-08-06',
			$ai_stream: true,
			$ai_input_tokens: 40,
			$ai_output_choices: [{ role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }]
		});
	});
});

describe('scores', () => {
	it('scores the current trace or a given one', async () => {
		const { client, sent } = tracemark();
		const ai = createAi(client);
		const traceId = await ai.trace({ name: 'answer', distinctId: 'ada' }, async () => {
			ai.score({ name: 'accuracy', value: 0.8 });
			return ai.currentTraceId();
		});
		expect(traceId).toBeTypeOf('string');
		expect(ai.currentTraceId()).toBeUndefined();
		ai.score({
			traceId,
			spanId: 'g1',
			name: 'thumbs',
			value: 0,
			comment: 'Wrong answer',
			distinctId: 'ada'
		});
		const scores = await sent('$ai_score');
		expect(scores).toHaveLength(2);
		expect(scores[0]).toMatchObject({
			distinct_id: 'ada',
			properties: { $ai_trace_id: traceId, $ai_score_name: 'accuracy', $ai_score_value: 0.8 }
		});
		expect(scores[0]?.properties).not.toHaveProperty('$ai_span_id');
		expect(scores[1]).toMatchObject({
			distinct_id: 'ada',
			properties: {
				$ai_trace_id: traceId,
				$ai_span_id: 'g1',
				$ai_score_name: 'thumbs',
				$ai_score_value: 0,
				$ai_score_comment: 'Wrong answer'
			}
		});
	});

	it('needs a trace and a number', () => {
		const ai = createAi(tracemark().client);
		expect(() => ai.score({ name: 'thumbs', value: 1 })).toThrow(/traceId/);
		expect(() => ai.score({ traceId: 't1', name: 'thumbs', value: Number.NaN })).toThrow(/number/);
	});
});
