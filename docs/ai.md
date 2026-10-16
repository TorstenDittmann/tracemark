# AI observability

footprint records LLM calls as events, like everything else: one `$ai_generation` per model call,
grouped into traces. Cost, tokens and latency per model and per person come from those events.

## Node SDK

`@footprint/node/ai` records calls made through the Anthropic and OpenAI SDKs and the Vercel AI SDK,
without changing what they return:

```ts
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { wrapLanguageModel } from 'ai';
import { openai as openaiModels } from '@ai-sdk/openai';
import { Footprint } from '@footprint/node';
import { createAi } from '@footprint/node/ai';

const footprint = new Footprint({ apiKey: 'fp_pub_…', host: 'https://footprint.example.com' });
const ai = createAi(footprint);

const anthropic = ai.wrapAnthropic(new Anthropic());
const openai = ai.wrapOpenAI(new OpenAI());
const model = wrapLanguageModel({ model: openaiModels('gpt-4o'), middleware: ai.middleware() });
```

- Anthropic: `messages.create` (streamed or not) and `messages.stream`.
- OpenAI: `chat.completions.create`, `responses.create` and `embeddings.create`. Streamed chat
  completions ask for usage (`stream_options: { include_usage: true }`) unless you set
  `stream_options`, so their last chunk carries the token counts and no choices.
- Vercel AI SDK: every `generateText`, `streamText`, `generateObject` and `streamObject` call on the
  wrapped model. The middleware targets AI SDK 7; pass `ai.middleware({ specificationVersion: 'v3' })`
  for AI SDK 6 or `'v2'` for 5.

Calls are recorded for `$server` unless you say who they're for. Group them into a trace, with
steps of your own as spans, and everything inside is recorded for that person:

```ts
const answer = await ai.trace({ name: 'answer-question', distinctId: user.id, input: question }, async () => {
  const docs = await ai.span({ name: 'retrieve', input: question }, () => search(question));
  const reply = await anthropic.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [/* … */] });
  return reply.content;
});
```

The trace is recorded as a `$ai_trace` event with what the function returned (or threw), and each
span as a `$ai_span`. Traces follow async calls through `AsyncLocalStorage`, so calls made deep
inside the function join them without passing anything along.

`createAi(footprint, { privacyMode: true })`, or `privacyMode: true` on a trace, leaves out inputs,
outputs and trace state: only models, tokens, cost and timing are sent. `properties` and `groups`
on either are added to every event.

## Events

| Event | What it is |
| :-- | :-- |
| `$ai_generation` | One call to a model: its input, output, tokens and latency. |
| `$ai_embedding` | One call to an embedding model. |
| `$ai_span` | A step of your own inside a trace, such as a retrieval or a tool call. |
| `$ai_trace` | A whole trace, such as one agent run or one chat turn. Optional: traces are built from the events that share a `$ai_trace_id`. |

Properties, all optional except where noted:

| Property | On | Meaning |
| :-- | :-- | :-- |
| `$ai_trace_id` | all | Groups the events of one trace. Required. |
| `$ai_span_id` | all | This event's id within the trace. |
| `$ai_parent_id` | all | The span id of the event this one ran under; the trace's top level when unset. |
| `$ai_span_name` | all | A name for the step, such as `retrieve` or `chat`. |
| `$ai_provider` | generation, embedding | `anthropic`, `openai`, … |
| `$ai_model` | generation, embedding | The model the provider reported, such as `claude-sonnet-4-5-20250929`. |
| `$ai_input` | generation, embedding | The messages sent, as an array of `{role, content}`. |
| `$ai_output_choices` | generation | The messages received, in the same shape. |
| `$ai_input_tokens` | generation, embedding | Every input token, including cached ones. |
| `$ai_output_tokens` | generation | Output tokens, including reasoning tokens. |
| `$ai_cache_read_input_tokens` | generation | Input tokens read from the provider's cache (also counted in `$ai_input_tokens`). |
| `$ai_cache_creation_input_tokens` | generation | Input tokens written to the cache (also counted in `$ai_input_tokens`). |
| `$ai_latency` | all | Seconds the call or step took. |
| `$ai_is_error`, `$ai_error` | all | Whether it failed, and the error. |
| `$ai_http_status` | generation, embedding | The provider's HTTP status. |
| `$ai_stream` | generation | Whether the response was streamed. |
| `$ai_temperature`, `$ai_max_tokens`, `$ai_tools` | generation | Request parameters. |
| `$ai_input_state`, `$ai_output_state` | span, trace | What the step took and returned, any JSON. |
| `$ai_cost_usd` | generation, embedding | Added at ingest, see below. |

## OpenTelemetry

Instrumentation that exports OpenTelemetry traces can send them to footprint instead of using an
SDK wrapper. `POST /v1/traces` on your footprint host takes OTLP/HTTP, as protobuf
(`application/x-protobuf`) or JSON (`application/json`), optionally gzipped. Authenticate with the
project's public key:

```sh
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://footprint.example.com/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Bearer fp_pub_…"
```

With the Vercel AI SDK, turn on telemetry per call and name the user in its metadata:

```ts
await generateText({
  model,
  prompt,
  experimental_telemetry: { isEnabled: true, functionId: 'answer-question', metadata: { userId: user.id } }
});
```

Each span becomes one event:

- spans whose `gen_ai.operation.name` is `chat`, `text_completion` or `generate_content`, and the
  Vercel AI SDK's `doGenerate` and `doStream` spans, become `$ai_generation`;
- `embeddings` spans and the Vercel AI SDK's `doEmbed` spans become `$ai_embedding`;
- other spans with `gen_ai.*`, `ai.*`, `llm.*` or `footprint.*` attributes become `$ai_span`;
- all other spans, such as HTTP and database spans, are dropped.

The trace and span ids become `$ai_trace_id`, `$ai_span_id` and `$ai_parent_id`; model, provider,
token counts, messages and errors are read from the GenAI semantic conventions and the Vercel AI
SDK's attributes. The person is the first of `footprint.distinct_id`, the Vercel AI SDK metadata
`distinct_id` or `userId`, `user.id` and `enduser.id`, on the span or its resource; spans that name
nobody are recorded for `otel:<service.name>`. Other Vercel AI SDK metadata becomes event
properties. The event id is derived from the trace and span ids, so a retried export repeats the
same ids.

## Cost

Ingest adds `$ai_cost_usd`, `$ai_input_cost_usd` and `$ai_output_cost_usd` to each `$ai_generation`
and `$ai_embedding` that has a `$ai_model` and token counts:

- input: uncached input tokens × the input price, plus cache reads and writes at their own prices
  (the input price when a model has none);
- output: output tokens × the output price.

Prices are USD per million tokens. footprint ships prices for common Anthropic, OpenAI and Google
models, and each project can add or change prices under Settings → Model prices. A model uses the
price with its exact name, else the longest name it starts with, ignoring case and any `provider/`
prefix: `gpt-4o` prices `gpt-4o-2024-08-06` and `openai/gpt-4o`, while `gpt-4o-mini` keeps its own
price. Events whose model has no price get no cost. A `$ai_cost_usd` the client sent is kept.

Prices apply to events as they arrive; changing a price does not recompute stored costs.
