// AI observability: records LLM calls as `$ai_generation` events and groups them into traces.
// See docs/ai.md for the events. Wrappers observe calls without changing what they return.
import { AsyncLocalStorage } from 'node:async_hooks';
import { aiMiddleware, type MiddlewareOptions, wrapAnthropic, wrapOpenAI } from './ai-providers';
import type { Properties, Tracemark } from './index';
import { uuidv7 } from './uuid';

export interface AiOptions {
	/** Who the calls are for, unless a trace says otherwise. Default `$server`. */
	distinctId?: string;
	/** Added to every event. */
	properties?: Properties;
	groups?: Record<string, string>;
	/** Leave out inputs, outputs and trace state; only models, tokens, cost and timing are sent. */
	privacyMode?: boolean;
}

export interface TraceOptions {
	/** Shown as the trace's name, such as `answer-question`. */
	name?: string;
	/** Who the trace is for. */
	distinctId?: string;
	/** Use your own id, such as a conversation turn's. Default: a new UUID. */
	traceId?: string;
	/** What the trace or span started with, shown with it. */
	input?: unknown;
	properties?: Properties;
	groups?: Record<string, string>;
	privacyMode?: boolean;
}

export type SpanOptions = Omit<TraceOptions, 'traceId'>;

export interface ScoreOptions {
	/** The trace the score is for. Default: the current trace. */
	traceId?: string;
	/** A step of the trace the score is for, such as one generation's span id. */
	spanId?: string;
	/** What is scored, such as `helpful`, `thumbs` or `accuracy`. */
	name: string;
	/** The score; thumbs up and down are 1 and 0. */
	value: number;
	comment?: string;
	/** Who gave the score. Default: the current trace's person. */
	distinctId?: string;
	properties?: Properties;
}

interface Context {
	traceId: string;
	/** The span new events run under. */
	parentId?: string;
	distinctId?: string;
	properties?: Properties;
	groups?: Record<string, string>;
	privacyMode?: boolean;
}

/** One model call, normalized across providers. */
export interface Generation {
	provider: string;
	model?: string;
	input?: unknown;
	output?: unknown;
	/** Every input token, including cached ones. */
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	latencyMs: number;
	stream?: boolean;
	error?: unknown;
	httpStatus?: number;
	temperature?: number;
	maxTokens?: number;
	tools?: unknown;
	embedding?: boolean;
}

const spanId = () => {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const message = (error: unknown) =>
	error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);

const status = (error: unknown): number | undefined => {
	const value = (error as { status?: unknown } | null)?.status;
	return typeof value === 'number' ? value : undefined;
};

const defined = (props: Properties) =>
	Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));

/** AI helpers bound to a client; create one with `createAi(tracemark)`. */
export class TracemarkAi {
	readonly #client: Tracemark;
	readonly #options: AiOptions;
	readonly #storage = new AsyncLocalStorage<Context>();

	constructor(client: Tracemark, options: AiOptions = {}) {
		this.#client = client;
		this.#options = options;
	}

	#context(): Context | undefined {
		return this.#storage.getStore();
	}

	#private(context: Context | undefined) {
		return context?.privacyMode ?? this.#options.privacyMode ?? false;
	}

	#send(event: string, context: Context | undefined, props: Properties, distinctId?: string) {
		this.#client.capture({
			distinctId: distinctId ?? context?.distinctId ?? this.#options.distinctId ?? '$server',
			event,
			groups: { ...this.#options.groups, ...context?.groups },
			properties: defined({
				...this.#options.properties,
				...context?.properties,
				...props
			})
		});
	}

	/** Records one model call; the wrappers call this, and so can your own integrations. */
	captureGeneration(generation: Generation) {
		const context = this.#context();
		const id = spanId();
		const hidden = this.#private(context);
		const failed = generation.error !== undefined;
		this.#send(generation.embedding ? '$ai_embedding' : '$ai_generation', context, {
			$ai_trace_id: context?.traceId ?? id,
			$ai_span_id: id,
			$ai_parent_id: context?.parentId,
			$ai_provider: generation.provider,
			$ai_model: generation.model,
			$ai_input: hidden ? undefined : generation.input,
			$ai_output_choices: hidden ? undefined : generation.output,
			$ai_input_tokens: generation.inputTokens,
			$ai_output_tokens: generation.outputTokens,
			$ai_cache_read_input_tokens: generation.cacheReadTokens || undefined,
			$ai_cache_creation_input_tokens: generation.cacheWriteTokens || undefined,
			$ai_latency: generation.latencyMs / 1000,
			$ai_stream: generation.stream,
			$ai_is_error: failed || undefined,
			$ai_error: failed ? message(generation.error) : undefined,
			$ai_http_status: generation.httpStatus ?? (failed ? status(generation.error) : undefined),
			$ai_temperature: generation.temperature,
			$ai_max_tokens: generation.maxTokens,
			$ai_tools: hidden ? undefined : generation.tools
		});
	}

	async #run<T>(
		event: '$ai_trace' | '$ai_span',
		options: TraceOptions,
		fn: () => T | Promise<T>
	): Promise<T> {
		const outer = event === '$ai_span' ? this.#context() : undefined;
		const id = spanId();
		const context: Context = {
			traceId: outer?.traceId ?? options.traceId ?? uuidv7(),
			parentId: id,
			distinctId: options.distinctId ?? outer?.distinctId,
			properties: { ...outer?.properties, ...options.properties },
			groups: { ...outer?.groups, ...options.groups },
			privacyMode: options.privacyMode ?? outer?.privacyMode
		};
		const hidden = this.#private(context);
		const started = performance.now();
		const finish = (output: unknown, error?: unknown) => {
			const failed = error !== undefined;
			this.#send(event, context, {
				$ai_trace_id: context.traceId,
				$ai_span_id: id,
				$ai_parent_id: outer?.parentId,
				$ai_span_name: options.name,
				$ai_latency: (performance.now() - started) / 1000,
				$ai_input_state: hidden ? undefined : options.input,
				$ai_output_state: hidden || failed ? undefined : output,
				$ai_is_error: failed || undefined,
				$ai_error: failed ? message(error) : undefined
			});
		};
		try {
			const result = await this.#storage.run(context, fn);
			finish(result);
			return result;
		} catch (error) {
			finish(undefined, error);
			throw error;
		}
	}

	/**
	 * Runs `fn` as one trace: model calls and spans inside it are grouped under it and recorded
	 * for its person. Records a `$ai_trace` event with what `fn` returned when it settles.
	 */
	trace<T>(options: TraceOptions, fn: () => T | Promise<T>): Promise<T> {
		return this.#run('$ai_trace', options, fn);
	}

	/** Runs `fn` as a step of the current trace (or a new one), recorded as a `$ai_span` event. */
	span<T>(options: SpanOptions, fn: () => T | Promise<T>): Promise<T> {
		return this.#run('$ai_span', options, fn);
	}

	/** The current trace's id, to score it later (for example from the browser). */
	currentTraceId(): string | undefined {
		return this.#context()?.traceId;
	}

	/**
	 * Records a score or piece of feedback for a trace or one of its steps as a `$ai_score`
	 * event. Throws when there is no trace to score or the value is not a finite number.
	 */
	score(options: ScoreOptions) {
		const context = this.#context();
		const traceId = options.traceId ?? context?.traceId;
		if (!traceId) throw new Error('tracemark: score() needs a traceId outside a trace');
		if (!Number.isFinite(options.value)) throw new Error('tracemark: score value must be a number');
		this.#send(
			'$ai_score',
			context,
			{
				...options.properties,
				$ai_trace_id: traceId,
				$ai_span_id: options.spanId,
				$ai_score_name: options.name,
				$ai_score_value: options.value,
				$ai_score_comment: options.comment
			},
			options.distinctId
		);
	}

	/** An Anthropic client that records its `messages.create` and `messages.stream` calls. */
	wrapAnthropic<T extends object>(client: T): T {
		return wrapAnthropic(this, client);
	}

	/** An OpenAI client that records chat completions, responses and embeddings. */
	wrapOpenAI<T extends object>(client: T): T {
		return wrapOpenAI(this, client);
	}

	/** Middleware for the Vercel AI SDK's `wrapLanguageModel`. */
	middleware(options?: MiddlewareOptions) {
		return aiMiddleware(this, options);
	}
}

/** The AI helpers for a client: wrappers for Anthropic and OpenAI, traces and spans. */
export function createAi(client: Tracemark, options?: AiOptions): TracemarkAi {
	return new TracemarkAi(client, options);
}
