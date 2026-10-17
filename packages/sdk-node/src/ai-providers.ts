// Wrappers that record calls made through the Anthropic and OpenAI SDKs and the Vercel AI SDK.
// They rely only on the shape of requests and responses, so they don't import those SDKs.
import type { Generation, TracemarkAi } from './ai';

type Params = Record<string, unknown> & { stream?: boolean };
type Create = (params: Params, ...rest: unknown[]) => unknown;
type Describe = (
	params: Params,
	result: unknown,
	error: unknown
) => Omit<Generation, 'latencyMs' | 'stream'>;
/** Collects a stream's chunks and describes the call once it ends. */
type StreamDescriber = (params: Params) => {
	chunk(chunk: unknown): void;
	describe(error: unknown): Omit<Generation, 'latencyMs' | 'stream'>;
};

const num = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const obj = (value: unknown) =>
	value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const requestSettings = (params: Params) => ({
	model: typeof params.model === 'string' ? params.model : undefined,
	temperature: num(params.temperature),
	maxTokens: num(params.max_tokens ?? params.max_completion_tokens ?? params.max_output_tokens),
	tools: params.tools
});

/** Calls `create`, records the call, and returns exactly what `create` returned. */
function record(
	ai: TracemarkAi,
	create: Create,
	self: unknown,
	args: unknown[],
	describe: Describe,
	streamed?: StreamDescriber
) {
	const params = (args[0] ?? {}) as Params;
	const started = performance.now();
	const capture = (generation: Omit<Generation, 'latencyMs'>) => {
		try {
			ai.captureGeneration({ ...generation, latencyMs: performance.now() - started });
		} catch {
			// Recording must never break the call.
		}
	};
	const result = create.apply(self, args as [Params, ...unknown[]]);
	const settle = (value: unknown) => {
		if (params.stream && streamed && value && Symbol.asyncIterator in (value as object)) {
			const collector = streamed(params);
			observeStream(
				value as AsyncIterable<unknown>,
				(chunk) => {
					try {
						collector.chunk(chunk);
					} catch {
						// An unexpected chunk only costs the recording.
					}
				},
				(error) => capture({ ...collector.describe(error), stream: true, error })
			);
		} else {
			capture({ ...describe(params, value, undefined), stream: false });
		}
	};
	if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
		// The SDKs return promises with extra methods (`withResponse()`), so hand back the original
		// and observe it on the side. This handler runs before the caller's, so a stream is
		// observed before anyone reads it.
		(result as PromiseLike<unknown>).then(settle, (error) =>
			capture({ ...describe(params, undefined, error), stream: params.stream === true, error })
		);
	} else {
		settle(result);
	}
	return result;
}

/** A proxy of `resource` whose methods named in `methods` are recorded. */
function wrapResource<T extends object>(
	resource: T,
	methods: Record<string, (create: Create) => Create>
): T {
	const wrapped = new Map<string, Create>();
	return new Proxy(resource, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof prop !== 'string' || typeof value !== 'function' || !(prop in methods))
				return value;
			let fn = wrapped.get(prop);
			if (!fn) {
				fn = methods[prop]?.(value as Create) as Create;
				wrapped.set(prop, fn);
			}
			return fn;
		}
	});
}

/** A proxy of `client` where the resources at `paths` (such as `chat.completions`) are wrapped. */
function wrapPaths<T extends object>(
	client: T,
	paths: Record<string, Record<string, (create: Create) => Create>>
): T {
	const tree = new Map<string, Record<string, Record<string, (create: Create) => Create>>>();
	for (const [path, methods] of Object.entries(paths)) {
		const [head, ...rest] = path.split('.');
		if (!head) continue;
		const sub = tree.get(head) ?? {};
		if (rest.length) sub[rest.join('.')] = methods;
		else sub[''] = methods;
		tree.set(head, sub);
	}
	const cache = new Map<string, unknown>();
	return new Proxy(client, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			const sub = typeof prop === 'string' ? tree.get(prop) : undefined;
			if (!sub || !value || typeof value !== 'object') return value;
			const key = prop as string;
			if (!cache.has(key)) {
				const { '': own, ...deeper } = sub;
				let wrapped: object = value;
				if (Object.keys(deeper).length) wrapped = wrapPaths(wrapped, deeper);
				if (own) wrapped = wrapResource(wrapped, own);
				cache.set(key, wrapped);
			}
			return cache.get(key);
		}
	});
}

/** Times a stream's consumption and records it once the stream ends, fails or is abandoned. */
function observeStream<T>(
	stream: AsyncIterable<T>,
	onChunk: (chunk: T) => void,
	onDone: (error?: unknown) => void
): void {
	const target = stream as AsyncIterable<T> & Record<symbol, unknown>;
	const original = target[Symbol.asyncIterator].bind(stream);
	let done = false;
	const finish = (error?: unknown) => {
		if (done) return;
		done = true;
		onDone(error);
	};
	target[Symbol.asyncIterator] = () => {
		const iterator = original();
		return {
			async next() {
				try {
					const step = await iterator.next();
					if (step.done) finish();
					else onChunk(step.value);
					return step;
				} catch (error) {
					finish(error);
					throw error;
				}
			},
			async return(value?: unknown) {
				finish();
				return iterator.return ? iterator.return(value) : { done: true as const, value };
			},
			async throw(error?: unknown) {
				finish(error);
				if (iterator.throw) return iterator.throw(error);
				throw error;
			},
			[Symbol.asyncIterator]() {
				return this;
			}
		} as AsyncIterator<T> & AsyncIterable<T>;
	};
}

// --- Anthropic ---------------------------------------------------------------------------------

interface AnthropicUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
}

/** Anthropic counts cached tokens apart from `input_tokens`; tracemark counts them in. */
function anthropicTokens(usage: AnthropicUsage | undefined) {
	if (!usage) return {};
	const read = num(usage.cache_read_input_tokens) ?? 0;
	const write = num(usage.cache_creation_input_tokens) ?? 0;
	const input = num(usage.input_tokens);
	return {
		inputTokens: input === undefined ? undefined : input + read + write,
		outputTokens: num(usage.output_tokens),
		cacheReadTokens: read,
		cacheWriteTokens: write
	};
}

function anthropicInput(params: Params) {
	const messages = Array.isArray(params.messages) ? params.messages : [];
	return params.system === undefined
		? messages
		: [{ role: 'system', content: params.system }, ...messages];
}

const describeAnthropic: Describe = (params, result) => {
	const message = obj(result);
	return {
		provider: 'anthropic',
		...requestSettings(params),
		model: (message?.model as string | undefined) ?? requestSettings(params).model,
		input: anthropicInput(params),
		output: message ? [{ role: 'assistant', content: message.content }] : undefined,
		...anthropicTokens(message?.usage as AnthropicUsage | undefined)
	};
};

const streamAnthropic: StreamDescriber = (params) => {
	let model: string | undefined;
	let usage: AnthropicUsage = {};
	const blocks: Record<string, unknown>[] = [];
	return {
		chunk(raw) {
			const event = obj(raw);
			switch (event?.type) {
				case 'message_start': {
					const message = obj(event.message);
					model = message?.model as string | undefined;
					usage = { ...(message?.usage as AnthropicUsage) };
					break;
				}
				case 'content_block_start':
					blocks[event.index as number] = { ...obj(event.content_block) };
					break;
				case 'content_block_delta': {
					const block = blocks[event.index as number];
					const delta = obj(event.delta);
					if (!block || !delta) break;
					if (delta.type === 'text_delta') block.text = `${block.text ?? ''}${delta.text}`;
					if (delta.type === 'thinking_delta')
						block.thinking = `${block.thinking ?? ''}${delta.thinking}`;
					if (delta.type === 'input_json_delta') {
						block.partial_json = `${block.partial_json ?? ''}${delta.partial_json}`;
					}
					break;
				}
				case 'message_delta': {
					// Its usage is cumulative, and newer models report input tokens here too.
					const delta = obj(event.usage) as AnthropicUsage | undefined;
					for (const [key, value] of Object.entries(delta ?? {})) {
						if (typeof value === 'number') usage[key as keyof AnthropicUsage] = value;
					}
					break;
				}
			}
		},
		describe() {
			const content = blocks.filter(Boolean).map(({ partial_json, ...block }) => {
				if (typeof partial_json !== 'string') return block;
				try {
					return { ...block, input: JSON.parse(partial_json) };
				} catch {
					return { ...block, input: partial_json };
				}
			});
			return {
				provider: 'anthropic',
				...requestSettings(params),
				model: model ?? requestSettings(params).model,
				input: anthropicInput(params),
				output: content.length ? [{ role: 'assistant', content }] : undefined,
				...anthropicTokens(usage)
			};
		}
	};
};

/**
 * Records every `messages.create` call (streamed or not, including `messages.stream`) made
 * through the returned client. Use it like the client you passed in.
 */
export function wrapAnthropic<T extends object>(ai: TracemarkAi, client: T): T {
	const create = (original: Create): Create =>
		function (this: unknown, ...args) {
			return record(ai, original, this, args, describeAnthropic, streamAnthropic);
		};
	return wrapPaths(client, { messages: { create }, 'beta.messages': { create } });
}

// --- OpenAI ------------------------------------------------------------------------------------

interface OpenAIUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	input_tokens?: number;
	output_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number } | null;
	input_tokens_details?: { cached_tokens?: number } | null;
}

/** OpenAI counts cached tokens inside the prompt tokens, as tracemark does. */
function openaiTokens(usage: OpenAIUsage | undefined | null) {
	if (!usage) return {};
	return {
		inputTokens: num(usage.prompt_tokens ?? usage.input_tokens),
		outputTokens: num(usage.completion_tokens ?? usage.output_tokens),
		cacheReadTokens: num(
			usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens
		)
	};
}

const describeChat: Describe = (params, result) => {
	const completion = obj(result);
	const choices = Array.isArray(completion?.choices) ? completion.choices : undefined;
	return {
		provider: 'openai',
		...requestSettings(params),
		model: (completion?.model as string | undefined) ?? requestSettings(params).model,
		input: params.messages,
		output: choices?.map((choice) => obj(choice)?.message),
		...openaiTokens(completion?.usage as OpenAIUsage | undefined)
	};
};

const streamChat: StreamDescriber = (params) => {
	let model: string | undefined;
	let usage: OpenAIUsage | undefined;
	const messages: { role: string; content: string; tool_calls?: Record<string, unknown>[] }[] = [];
	return {
		chunk(raw) {
			const chunk = obj(raw);
			if (!chunk) return;
			model = (chunk.model as string | undefined) ?? model;
			if (chunk.usage) usage = chunk.usage as OpenAIUsage;
			for (const choice of (chunk.choices as Record<string, unknown>[] | undefined) ?? []) {
				const index = (choice.index as number | undefined) ?? 0;
				const delta = obj(choice.delta);
				const message = messages[index] ?? { role: 'assistant', content: '' };
				messages[index] = message;
				if (typeof delta?.content === 'string') message.content += delta.content;
				for (const call of (delta?.tool_calls as Record<string, unknown>[] | undefined) ?? []) {
					message.tool_calls ??= [];
					const at = (call.index as number | undefined) ?? message.tool_calls.length;
					const existing = message.tool_calls[at] ?? {
						id: call.id,
						type: 'function',
						function: { name: '', arguments: '' }
					};
					const fn = obj(existing.function) as { name: string; arguments: string };
					const part = obj(call.function);
					if (typeof part?.name === 'string') fn.name += part.name;
					if (typeof part?.arguments === 'string') fn.arguments += part.arguments;
					message.tool_calls[at] = existing;
				}
			}
		},
		describe() {
			return {
				provider: 'openai',
				...requestSettings(params),
				model: model ?? requestSettings(params).model,
				input: params.messages,
				output: messages.filter(Boolean),
				...openaiTokens(usage)
			};
		}
	};
};

function responsesInput(params: Params) {
	const input =
		typeof params.input === 'string' ? [{ role: 'user', content: params.input }] : params.input;
	return params.instructions === undefined
		? input
		: [
				{ role: 'system', content: params.instructions },
				...(Array.isArray(input) ? input : [input])
			];
}

const describeResponse: Describe = (params, result) => {
	const response = obj(result);
	return {
		provider: 'openai',
		...requestSettings(params),
		model: (response?.model as string | undefined) ?? requestSettings(params).model,
		input: responsesInput(params),
		output: response?.output,
		...openaiTokens(response?.usage as OpenAIUsage | undefined)
	};
};

const streamResponse: StreamDescriber = (params) => {
	let final: unknown;
	return {
		chunk(raw) {
			const event = obj(raw);
			if (event?.type === 'response.completed' || event?.type === 'response.incomplete') {
				final = event.response;
			}
		},
		describe(error) {
			return describeResponse(params, final, error);
		}
	};
};

const describeEmbedding: Describe = (params, result) => {
	const response = obj(result);
	return {
		provider: 'openai',
		embedding: true,
		model: (response?.model as string | undefined) ?? requestSettings(params).model,
		input: params.input,
		inputTokens: num(obj(response?.usage)?.prompt_tokens)
	};
};

/**
 * Records `chat.completions.create`, `responses.create` and `embeddings.create` calls made through
 * the returned client. Streamed chat completions ask for usage (`stream_options.include_usage`)
 * unless you set `stream_options`, so the last chunk carries token counts and no choices.
 */
export function wrapOpenAI<T extends object>(ai: TracemarkAi, client: T): T {
	const wrap =
		(describe: Describe, streamed?: StreamDescriber, prepare?: (params: Params) => Params) =>
		(original: Create): Create =>
			function (this: unknown, ...args) {
				if (prepare && args[0]) args = [prepare(args[0] as Params), ...args.slice(1)];
				return record(ai, original, this, args, describe, streamed);
			};
	const includeUsage = (params: Params) =>
		params.stream && params.stream_options === undefined
			? { ...params, stream_options: { include_usage: true } }
			: params;
	return wrapPaths(client, {
		'chat.completions': { create: wrap(describeChat, streamChat, includeUsage) },
		responses: { create: wrap(describeResponse, streamResponse) },
		embeddings: { create: wrap(describeEmbedding) }
	});
}

// --- Vercel AI SDK -----------------------------------------------------------------------------

/** Usage as AI SDK 5 (numbers) and AI SDK 6+ (objects with totals) report it. */
function vercelTokens(usage: unknown) {
	const u = obj(usage);
	if (!u) return {};
	const input = u.inputTokens;
	const output = u.outputTokens;
	if (input && typeof input === 'object') {
		const i = input as Record<string, unknown>;
		return {
			inputTokens: num(i.total),
			outputTokens: num(obj(output)?.total),
			cacheReadTokens: num(i.cacheRead),
			cacheWriteTokens: num(i.cacheWrite)
		};
	}
	return {
		inputTokens: num(input),
		outputTokens: num(output),
		cacheReadTokens: num(u.cachedInputTokens)
	};
}

export interface VercelModel {
	provider?: string;
	modelId?: string;
}

function vercelBase(model: VercelModel, params: Record<string, unknown>) {
	return {
		provider: (model.provider ?? 'unknown').split('.')[0] ?? 'unknown',
		model: model.modelId,
		input: params.prompt,
		temperature: num(params.temperature),
		maxTokens: num(params.maxOutputTokens),
		tools: params.tools
	};
}

function vercelOutput(content: unknown) {
	return Array.isArray(content) && content.length ? [{ role: 'assistant', content }] : undefined;
}

export interface MiddlewareOptions {
	/** The `specificationVersion` your AI SDK expects: `v4` for AI SDK 7, `v3` for 6, `v2` for 5. */
	specificationVersion?: 'v2' | 'v3' | 'v4';
}

/** What `wrapLanguageModel` passes to a middleware's `wrapGenerate` and `wrapStream`. */
export interface VercelCallOptions {
	params: Record<string, unknown>;
	model: VercelModel;
}

export interface TracemarkMiddleware {
	specificationVersion: 'v2' | 'v3' | 'v4';
	middlewareVersion: 'v2' | 'v3' | 'v4';
	wrapGenerate<R>(options: VercelCallOptions & { doGenerate: () => PromiseLike<R> }): Promise<R>;
	wrapStream<R extends { stream: ReadableStream<unknown> }>(
		options: VercelCallOptions & { doStream: () => PromiseLike<R> }
	): Promise<R>;
}

/**
 * Middleware for the Vercel AI SDK's `wrapLanguageModel` that records each model call:
 * `wrapLanguageModel({ model, middleware: aiMiddleware(ai) })`.
 */
export function aiMiddleware(
	ai: TracemarkAi,
	options: MiddlewareOptions = {}
): TracemarkMiddleware {
	const version = options.specificationVersion ?? 'v4';
	const capture = (generation: Generation) => {
		try {
			ai.captureGeneration(generation);
		} catch {
			// Recording must never break the call.
		}
	};
	return {
		specificationVersion: version,
		middlewareVersion: version,
		async wrapGenerate<R>({
			doGenerate,
			params,
			model
		}: VercelCallOptions & { doGenerate: () => PromiseLike<R> }) {
			const started = performance.now();
			try {
				const result = await doGenerate();
				const fields = obj(result);
				const response = obj(fields?.response);
				capture({
					...vercelBase(model, params),
					model: (response?.modelId as string | undefined) ?? model.modelId,
					output: vercelOutput(fields?.content),
					...vercelTokens(fields?.usage),
					stream: false,
					latencyMs: performance.now() - started
				});
				return result;
			} catch (error) {
				capture({
					...vercelBase(model, params),
					stream: false,
					error,
					latencyMs: performance.now() - started
				});
				throw error;
			}
		},
		async wrapStream<R extends { stream: ReadableStream<unknown> }>({
			doStream,
			params,
			model
		}: VercelCallOptions & { doStream: () => PromiseLike<R> }) {
			const started = performance.now();
			let result: R;
			try {
				result = await doStream();
			} catch (error) {
				capture({
					...vercelBase(model, params),
					stream: true,
					error,
					latencyMs: performance.now() - started
				});
				throw error;
			}
			let text = '';
			let usage: unknown;
			let modelId: string | undefined;
			let failure: unknown;
			let done = false;
			const toolCalls: unknown[] = [];
			const finish = () => {
				if (done) return;
				done = true;
				capture({
					...vercelBase(model, params),
					model: modelId ?? model.modelId,
					output: vercelOutput([...(text ? [{ type: 'text', text }] : []), ...toolCalls]),
					...vercelTokens(usage),
					stream: true,
					error: failure,
					latencyMs: performance.now() - started
				});
			};
			const stream = result.stream.pipeThrough(
				new TransformStream<unknown, unknown>({
					transform(chunk, controller) {
						const part = obj(chunk);
						if (part?.type === 'text-delta') text += String(part.delta ?? part.textDelta ?? '');
						if (part?.type === 'tool-call') toolCalls.push(part);
						if (part?.type === 'response-metadata' && typeof part.modelId === 'string')
							modelId = part.modelId;
						if (part?.type === 'finish') usage = part.usage;
						if (part?.type === 'error') failure = part.error;
						controller.enqueue(chunk);
					},
					flush: finish,
					// A reader that stops early still gets its call recorded.
					cancel: finish
				} as Transformer<unknown, unknown>)
			);
			return { ...result, stream };
		}
	};
}
