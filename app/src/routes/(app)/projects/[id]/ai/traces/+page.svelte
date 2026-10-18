<script lang="ts">
import Waypoints from '@lucide/svelte/icons/waypoints';
import { formatCost, formatDuration, formatScore, formatTokens } from '#lib/ai.js';
import AiNav from '#lib/components/ai/ai-nav.svelte';
import EmptyState from '#lib/components/empty-state.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Checkbox } from '#lib/components/ui/checkbox/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import * as NativeSelect from '#lib/components/ui/native-select/index.js';
import { personHref } from '#lib/persons.js';
import { RANGES } from '#lib/web.js';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const rangeLabel = $derived(RANGES[data.range].label.toLowerCase());
const anonymous = (person: string) => person === '$server' || person.startsWith('otel');

const clearPerson = $derived.by(() => {
	const url = new URL(page.url.href);
	url.searchParams.delete('person');
	return `${url.pathname}${url.search}`;
});
const filtered = $derived(
	Boolean(
		data.filter.score ||
			data.filter.min !== undefined ||
			data.filter.max !== undefined ||
			data.filter.negative
	)
);
const clearScores = $derived.by(() => {
	const url = new URL(page.url.href);
	for (const key of ['score', 'min', 'max', 'negative']) url.searchParams.delete(key);
	return `${url.pathname}${url.search}`;
});
const traceHref = (traceId: string) =>
	`/projects/${data.project.id}/ai/traces/${encodeURIComponent(traceId)}`;
</script>

<svelte:head>
	<title>AI traces · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-4">
	<AiNav projectId={data.project.id} current="traces" range={data.range} />

	{#if data.person}
		<p class="flex flex-wrap items-center gap-2 text-sm">
			<span class="text-muted-foreground">Person</span>
			<a class="font-medium hover:underline" href={personHref(data.project.id, data.person)}
				>{data.person}</a
			>
			<a class="text-muted-foreground underline hover:text-foreground" href={clearPerson}>Clear</a>
		</p>
	{/if}

	{#if data.scoreNames.length || filtered}
		<form method="GET" class="flex flex-wrap items-end gap-3 text-sm" aria-label="Filter by score">
			<input type="hidden" name="range" value={data.range}>
			{#if data.person}
				<input type="hidden" name="person" value={data.person}>
			{/if}
			<div class="grid gap-1.5">
				<Label for="score">Score</Label>
				<NativeSelect.Root id="score" name="score" value={data.filter.score ?? ''} class="w-40">
					<NativeSelect.Option value="">Any</NativeSelect.Option>
					{#each data.scoreNames as name (name)}
						<NativeSelect.Option value={name}>{name}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			<div class="grid gap-1.5">
				<Label for="min">Min</Label>
				<Input id="min" name="min" type="number" step="any" class="w-24" value={data.filter.min} />
			</div>
			<div class="grid gap-1.5">
				<Label for="max">Max</Label>
				<Input id="max" name="max" type="number" step="any" class="w-24" value={data.filter.max} />
			</div>
			<div class="flex h-9 items-center gap-2">
				<Checkbox id="negative" name="negative" value="1" checked={data.filter.negative ?? false} />
				<Label for="negative">Negative feedback</Label>
			</div>
			<Button type="submit" variant="outline">Filter</Button>
			{#if filtered}
				<a
					class="flex h-9 items-center text-muted-foreground underline hover:text-foreground"
					href={clearScores}
					>Clear</a
				>
			{/if}
		</form>
	{/if}

	{#if !data.traces}
		<p class="text-sm text-muted-foreground">
			Traces are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<Card.Root class="min-w-0 gap-0 py-0">
			{#if data.traces.length}
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<caption class="sr-only">
							AI traces in the {rangeLabel}
						</caption>
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="py-2 pr-4 pl-4 font-normal sm:pl-6">Trace</th>
								<th class="hidden px-4 py-2 font-normal md:table-cell">Person</th>
								<th class="hidden px-4 py-2 font-normal sm:table-cell">Scores</th>
								<th class="px-4 py-2 text-right font-normal">Duration</th>
								<th class="hidden px-4 py-2 text-right font-normal sm:table-cell">Calls</th>
								<th class="hidden px-4 py-2 text-right font-normal lg:table-cell">Tokens</th>
								<th class="py-2 pr-4 pl-4 text-right font-normal sm:pr-6">Cost</th>
							</tr>
						</thead>
						<tbody>
							{#each data.traces as trace (trace.traceId)}
								<tr class="border-t align-top">
									<td class="max-w-[11rem] py-3 pr-4 pl-4 sm:max-w-[28rem] sm:pl-6">
										<a
											class="block truncate font-medium hover:underline"
											href={traceHref(trace.traceId)}
										>
											{trace.name || trace.traceId}
										</a>
										<span class="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
											<span>{dateFormat.format(new Date(trace.startedAt))}</span>
											{#if trace.errors}
												<span class="text-destructive">
													{trace.errors}
													{trace.errors === 1 ? 'error' : 'errors'}
												</span>
											{/if}
										</span>
									</td>
									<td class="hidden max-w-[12rem] px-4 py-3 md:table-cell">
										{#if anonymous(trace.person)}
											<span class="block truncate text-muted-foreground">{trace.person}</span>
										{:else}
											<a
												class="block truncate hover:underline"
												href={personHref(data.project.id, trace.person)}
												>{trace.person}</a
											>
										{/if}
									</td>
									<td class="hidden px-4 py-3 sm:table-cell">
										<span class="flex flex-wrap gap-1">
											{#each trace.scores as score (score.name)}
												<span
													class={[
														'rounded px-1.5 text-xs whitespace-nowrap tabular-nums',
														score.avg <= 0
															? 'bg-destructive/10 text-destructive'
															: 'bg-muted text-muted-foreground'
													]}
													title="{score.count} {score.count === 1 ? 'score' : 'scores'}"
												>
													{score.name}
													<span class="font-medium text-foreground">{formatScore(score.avg)}</span>
												</span>
											{:else}
												<span class="text-muted-foreground">–</span>
											{/each}
										</span>
									</td>
									<td class="px-4 py-3 text-right whitespace-nowrap tabular-nums">
										{formatDuration(trace.duration)}
									</td>
									<td class="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
										{trace.calls.toLocaleString()}
									</td>
									<td
										class="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums lg:table-cell"
									>
										{formatTokens(trace.inputTokens)}
										/ {formatTokens(trace.outputTokens)}
									</td>
									<td class="py-3 pr-4 pl-4 text-right tabular-nums sm:pr-6">
										{formatCost(trace.cost)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<EmptyState
					icon={Waypoints}
					title={filtered
						? `No traces in the ${rangeLabel} match these scores`
						: `No traces in the ${rangeLabel}`}
				/>
			{/if}
		</Card.Root>
	{/if}
</div>
