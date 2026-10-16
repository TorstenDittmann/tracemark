<script lang="ts">
import {
	asMessages,
	buildTree,
	flatten,
	formatCost,
	formatDuration,
	formatTokens,
	type NodeKind,
	num,
	type TraceNode
} from '#lib/ai.js';
import AiNav from '#lib/components/ai/ai-nav.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { personHref } from '#lib/persons.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const KIND_LABELS: Record<NodeKind, string> = {
	trace: 'Trace',
	span: 'Span',
	generation: 'Generation',
	embedding: 'Embedding'
};
const BADGES: Record<NodeKind, string> = {
	trace: 'Trace',
	span: 'Span',
	generation: 'LLM',
	embedding: 'Embed'
};
/** Properties shown in their own sections, left out of the rest. */
const SHOWN = new Set([
	'$ai_trace_id',
	'$ai_span_id',
	'$ai_parent_id',
	'$ai_span_name',
	'$ai_model',
	'$ai_provider',
	'$ai_input',
	'$ai_output_choices',
	'$ai_input_state',
	'$ai_output_state',
	'$ai_input_tokens',
	'$ai_output_tokens',
	'$ai_cache_read_input_tokens',
	'$ai_cache_creation_input_tokens',
	'$ai_latency',
	'$ai_cost_usd',
	'$ai_input_cost_usd',
	'$ai_output_cost_usd',
	'$ai_is_error',
	'$ai_error'
]);

const roots = $derived(buildTree(data.events ?? []));
const rows = $derived(flatten(roots));
/** The trace's length in ms: from its first event to the last one's end. */
const span = $derived(Math.max(1, ...rows.map(({ node }) => node.offset + node.duration)));
let selectedId = $state<string | null>(null);
const selected = $derived(
	rows.find(({ node }) => node.id === selectedId)?.node ?? rows[0]?.node ?? null
);
const root = $derived(roots.length === 1 ? roots[0] : null);
const person = $derived(data.events?.find((e) => e.person)?.person ?? '');
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

function stats(node: TraceNode): { label: string; value: string; wide?: boolean }[] {
	const p = node.event.properties;
	const out: { label: string; value: string; wide?: boolean }[] = [];
	const model = p.$ai_model;
	if (typeof model === 'string' && model) {
		out.push({
			label: 'Model',
			value:
				typeof p.$ai_provider === 'string' && p.$ai_provider
					? `${model} (${p.$ai_provider})`
					: model,
			wide: true
		});
	}
	if (node.duration) out.push({ label: 'Latency', value: formatDuration(node.duration / 1000) });
	const input = num(p.$ai_input_tokens);
	const output = num(p.$ai_output_tokens);
	if (input !== undefined) out.push({ label: 'Input tokens', value: formatTokens(input) });
	const cacheRead = num(p.$ai_cache_read_input_tokens);
	if (cacheRead) out.push({ label: 'Cache reads', value: formatTokens(cacheRead) });
	const cacheWrite = num(p.$ai_cache_creation_input_tokens);
	if (cacheWrite) out.push({ label: 'Cache writes', value: formatTokens(cacheWrite) });
	if (output !== undefined) out.push({ label: 'Output tokens', value: formatTokens(output) });
	if (node.cost || node.kind === 'generation' || node.kind === 'embedding') {
		out.push({
			label: node.children.length ? 'Cost (with children)' : 'Cost',
			value: formatCost(node.cost)
		});
	}
	return out;
}

function io(node: TraceNode): { label: string; value: unknown }[] {
	const p = node.event.properties;
	return [
		{ label: 'Input', value: p.$ai_input ?? p.$ai_input_state },
		{ label: 'Output', value: p.$ai_output_choices ?? p.$ai_output_state }
	].filter((part) => part.value !== undefined && part.value !== null && part.value !== '');
}

function rest(node: TraceNode): [string, unknown][] {
	return Object.entries(node.event.properties)
		.filter(([key]) => !SHOWN.has(key))
		.sort(([a], [b]) => a.localeCompare(b));
}

const pretty = (value: unknown) =>
	typeof value === 'string' ? value : JSON.stringify(value, null, 2);
</script>

<svelte:head>
	<title>{root?.name ?? 'Trace'} · AI · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<AiNav projectId={data.project.id} current="traces" />

	{#if !data.events}
		<p class="text-sm text-muted-foreground">
			This trace is unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<div class="grid gap-1">
			<h2 class="truncate text-lg font-semibold">{root?.name ?? data.traceId}</h2>
			<p class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
				<span>{dateFormat.format(new Date(data.events[0]?.timestamp ?? Date.now()))}</span>
				{#if person}
					<a class="hover:underline" href={personHref(data.project.id, person)}>{person}</a>
				{/if}
				<span class="tabular-nums">{formatDuration(span / 1000)}</span>
				<span class="tabular-nums">
					{formatCost(roots.reduce((sum, node) => sum + node.cost, 0))}
				</span>
				<span class="font-mono text-xs leading-5 break-all">{data.traceId}</span>
			</p>
		</div>

		<div class="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<Card.Root class="min-w-0 gap-0 py-2">
				<ol class="grid" aria-label="Trace steps">
					{#each rows as { node, depth } (node.id)}
						<li>
							<button
								type="button"
								onclick={() => (selectedId = node.id)}
								aria-current={selected === node ? 'true' : undefined}
								class={[
									'grid w-full grid-cols-[minmax(0,1fr)_minmax(0,40%)] items-center gap-3 px-4 py-1.5 text-left text-sm',
									selected === node ? 'bg-secondary' : 'hover:bg-muted/50'
								]}
							>
								<span
									class="flex min-w-0 items-center gap-2"
									style:padding-left="{Math.min(depth, 8) * 0.875}rem"
								>
									<span
										class={[
											'shrink-0 rounded px-1 text-[0.7rem] font-medium',
											node.error
												? 'bg-destructive/15 text-destructive'
												: node.kind === 'generation' || node.kind === 'embedding'
													? 'bg-primary/10 text-primary'
													: 'bg-muted text-muted-foreground'
										]}
									>
										{BADGES[node.kind]}
									</span>
									<span class="truncate" title={node.name}>{node.name}</span>
									{#if node.cost && !node.children.length}
										<span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
											{formatCost(node.cost)}
										</span>
									{/if}
								</span>
								<span class="relative h-4" aria-hidden="true">
									<span
										class={[
											'absolute top-1 h-2 min-w-0.5 rounded-sm',
											node.error
												? 'bg-destructive'
												: node.kind === 'trace' || node.kind === 'span'
													? 'bg-muted-foreground/40'
													: 'bg-primary'
										]}
										style:left="{(node.offset / span) * 100}%"
										style:width="{Math.max((node.duration / span) * 100, 0.5)}%"
									></span>
								</span>
								<span class="sr-only">
									{KIND_LABELS[node.kind]}, starts at {formatDuration(node.offset / 1000)}, takes
									{formatDuration(node.duration / 1000)}{node.error
										? `, failed: ${node.error}`
										: ''}
								</span>
							</button>
						</li>
					{/each}
				</ol>
				{#if data.events.length >= 2000}
					<p class="px-4 pt-2 text-xs text-muted-foreground">Showing the first 2,000 steps.</p>
				{/if}
			</Card.Root>

			{#if selected}
				<Card.Root class="min-w-0 gap-4 lg:sticky lg:top-4">
					<Card.Header>
						<Card.Description>{KIND_LABELS[selected.kind]}</Card.Description>
						<Card.Title class="break-words">{selected.name}</Card.Title>
					</Card.Header>
					<Card.Content class="grid gap-4 text-sm">
						{#if selected.error}
							<p class="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
								{selected.error}
							</p>
						{/if}
						{@const facts = stats(selected)}
						{#if facts.length}
							<dl class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
								{#each facts as fact (fact.label)}
									<div class={['min-w-0', fact.wide && 'col-span-full']}>
										<dt class="text-xs text-muted-foreground">{fact.label}</dt>
										<dd class="truncate tabular-nums" title={fact.value}>{fact.value}</dd>
									</div>
								{/each}
							</dl>
						{/if}

						{#each io(selected) as part (part.label)}
							{@const messages = asMessages(part.value)}
							<section class="grid gap-2">
								<h3 class="text-xs font-medium text-muted-foreground">{part.label}</h3>
								{#if messages}
									{#each messages as message, i (i)}
										<div class="grid gap-1 rounded-md border px-3 py-2">
											<span class="text-xs font-medium text-muted-foreground capitalize"
												>{message.role}</span
											>
											{#each message.parts as content, j (j)}
												{#if content.kind === 'text'}
													<p class="break-words whitespace-pre-wrap">{content.value}</p>
												{:else}
													<pre
														class="overflow-x-auto rounded bg-muted px-2 py-1 text-xs"
													>{content.value}</pre>
												{/if}
											{/each}
										</div>
									{/each}
								{:else}
									<pre
										class="max-h-96 overflow-auto rounded-md bg-muted px-3 py-2 text-xs"
									>{pretty(part.value)}</pre>
								{/if}
							</section>
						{/each}

						{#if rest(selected).length}
							<details>
								<summary class="cursor-pointer text-xs font-medium text-muted-foreground">
									All properties
								</summary>
								<dl class="mt-2 grid gap-1">
									{#each rest(selected) as [key, value] (key)}
										<div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 border-t pt-1">
											<dt class="truncate font-mono text-xs" title={key}>{key}</dt>
											<dd class="font-mono text-xs break-all whitespace-pre-wrap">
												{pretty(value)}
											</dd>
										</div>
									{/each}
								</dl>
							</details>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	{/if}
</div>
