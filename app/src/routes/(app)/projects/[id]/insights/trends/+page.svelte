<script lang="ts">
import LineChart from '#lib/components/charts/line-chart.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import {
	type Aggregation,
	MATHS,
	MAX_FILTERS,
	MAX_SERIES,
	needsProperty,
	OPERATORS,
	type Operator,
	type TrendsQuery
} from '#lib/insights.js';
import { RANGES, type Range } from '#lib/web.js';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const ranges = Object.keys(RANGES) as Range[];
const select =
	'h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs dark:bg-input/30';

/** Applies a change to a copy of the current query and loads it. */
function update(change: (query: TrendsQuery) => void) {
	const next = structuredClone($state.snapshot(data.query)) as TrendsQuery;
	change(next);
	const url = new URL(page.url.href);
	url.searchParams.set('q', JSON.stringify(next));
	goto(`${url.pathname}${url.search}`, { reset: false });
}

/** Known names plus the current one, so a value missing from recent data still shows. */
function withCurrent(names: string[], current: string | undefined): string[] {
	return current && !names.includes(current) ? [current, ...names] : names;
}

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
const numericProperties = $derived(data.properties.filter((p) => p.numeric).map((p) => p.name));
const valueFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const format = (value: number) => valueFormat.format(value);

const lines = $derived(
	data.result?.lines.map((line, i) => ({
		key: `${line.series}:${line.breakdown ?? ''}:${i}`,
		label:
			line.breakdown === undefined
				? line.label
				: `${line.label} · ${line.breakdown === '' ? 'None' : line.breakdown}`,
		data: line.data,
		total: line.total
	})) ?? []
);
</script>

<svelte:head>
	<title>Insights · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<Card.Root class="gap-4">
		<Card.Header>
			<Card.Title>Trends</Card.Title>
			<Card.Description
				>Count events over time, by people or by a numeric property.</Card.Description
			>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<section class="grid gap-2">
				<h3 class="text-sm font-medium">Series</h3>
				{#each data.query.series as series, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						{#if !data.query.breakdown}
							<!-- Without a breakdown each series is one line, in this color. -->
							<span
								class="size-2.5 shrink-0 rounded-full"
								style:background="var(--series-{(i % 8) + 1})"
								aria-hidden="true"
							></span>
						{/if}
						<select
							class={select}
							aria-label="Event"
							value={series.event}
							onchange={(e) => update((q) => (q.series[i].event = e.currentTarget.value))}
						>
							{#each withCurrent(eventOptions, series.event) as event (event)}
								<option value={event}>{event}</option>
							{/each}
						</select>
						<select
							class={select}
							aria-label="Measure"
							value={series.math}
							onchange={(e) =>
								update((q) => {
									const math = e.currentTarget.value as Aggregation;
									q.series[i].math = math;
									if (needsProperty(math))
										q.series[i].property ??= numericProperties[0] ?? allProperties[0];
									else delete q.series[i].property;
								})}
						>
							{#each Object.entries(MATHS) as [value, label] (value)}
								<option {value}>{label}</option>
							{/each}
						</select>
						{#if needsProperty(series.math)}
							<select
								class={select}
								aria-label="Property"
								value={series.property}
								onchange={(e) => update((q) => (q.series[i].property = e.currentTarget.value))}
							>
								{#each withCurrent(numericProperties, series.property) as property (property)}
									<option value={property}>{property}</option>
								{/each}
							</select>
						{/if}
						{#if data.query.series.length > 1}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => update((q) => q.series.splice(i, 1))}
								aria-label="Remove series"
							>
								Remove
							</Button>
						{/if}
					</div>
				{/each}
				{#if data.query.series.length < MAX_SERIES}
					<div>
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								update((q) =>
									q.series.push({ event: eventOptions[0] ?? '$pageview', math: 'total' })
								)}
						>
							Add series
						</Button>
					</div>
				{/if}
			</section>

			<section class="grid gap-2">
				<h3 class="text-sm font-medium">Filters</h3>
				{#each data.query.filters as filter, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<select
							class={select}
							aria-label="Filter property"
							value={filter.property}
							onchange={(e) => update((q) => (q.filters[i].property = e.currentTarget.value))}
						>
							{#each withCurrent(allProperties, filter.property) as property (property)}
								<option value={property}>{property}</option>
							{/each}
						</select>
						<select
							class={select}
							aria-label="Operator"
							value={filter.operator}
							onchange={(e) =>
								update((q) => {
									const operator = e.currentTarget.value as Operator;
									q.filters[i].operator = operator;
									if (operator === 'is_set' || operator === 'is_not_set') delete q.filters[i].value;
									else q.filters[i].value ??= '';
								})}
						>
							{#each Object.entries(OPERATORS) as [value, label] (value)}
								<option {value}>{label}</option>
							{/each}
						</select>
						{#if filter.value !== undefined}
							<input
								class="{select} w-40"
								aria-label="Value"
								value={filter.value}
								onchange={(e) => update((q) => (q.filters[i].value = e.currentTarget.value))}
							>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => update((q) => q.filters.splice(i, 1))}
							aria-label="Remove filter"
						>
							Remove
						</Button>
					</div>
				{/each}
				{#if data.query.filters.length < MAX_FILTERS && allProperties.length}
					<div>
						<Button
							variant="outline"
							size="sm"
							onclick={() =>
								update((q) =>
									q.filters.push({ property: allProperties[0], operator: 'eq', value: '' })
								)}
						>
							Add filter
						</Button>
					</div>
				{/if}
			</section>

			<div class="flex flex-wrap items-center gap-4">
				<label class="flex items-center gap-2 text-sm">
					<span class="font-medium">Breakdown</span>
					<select
						class={select}
						value={data.query.breakdown ?? ''}
						onchange={(e) =>
							update((q) => {
								if (e.currentTarget.value) q.breakdown = e.currentTarget.value;
								else delete q.breakdown;
							})}
					>
						<option value="">None</option>
						{#each withCurrent(allProperties, data.query.breakdown) as property (property)}
							<option value={property}>{property}</option>
						{/each}
					</select>
				</label>
				<fieldset class="inline-flex rounded-md border p-0.5 text-sm">
					<legend class="sr-only">Date range</legend>
					{#each ranges as range (range)}
						<button
							type="button"
							title={RANGES[range].label}
							aria-pressed={data.query.range === range}
							onclick={() => update((q) => (q.range = range))}
							class={[
								'rounded px-2.5 py-1',
								data.query.range === range
									? 'bg-secondary font-medium text-secondary-foreground'
									: 'text-muted-foreground hover:text-foreground'
							]}
						>
							{range}
						</button>
					{/each}
				</fieldset>
			</div>
		</Card.Content>
	</Card.Root>

	{#if !data.result}
		<p class="text-sm text-muted-foreground">
			Insights are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<Card.Root>
			<Card.Content>
				{#if lines.length}
					<LineChart {lines} buckets={data.result.buckets} bucket={data.result.bucket} {format} />
				{:else}
					<p class="py-12 text-center text-sm text-muted-foreground">No events match this query.</p>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if lines.length}
			<Card.Root class="py-2">
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Series</th>
							<th class="px-6 py-2 text-right font-normal">
								{RANGES[data.query.range].label}
							</th>
						</tr>
					</thead>
					<tbody>
						{#each lines as line, i (line.key)}
							<tr class="border-t">
								<td class="px-6 py-2">
									<span class="flex items-center gap-2">
										<span
											class="size-2.5 shrink-0 rounded-full"
											style:background="var(--series-{(i % 8) + 1})"
											aria-hidden="true"
										></span>
										{line.label}
									</span>
								</td>
								<td class="px-6 py-2 text-right tabular-nums">{format(line.total)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card.Root>
		{/if}
	{/if}
</div>
