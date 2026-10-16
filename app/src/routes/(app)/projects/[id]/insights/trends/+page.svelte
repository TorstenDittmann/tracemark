<script lang="ts">
import LineChart from '#lib/components/charts/line-chart.svelte';
import BreakdownSelect from '#lib/components/insights/breakdown-select.svelte';
import {
	selectClass as select,
	showQuery,
	withCurrent
} from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import {
	type Aggregation,
	MATHS,
	MAX_SERIES,
	needsProperty,
	type TrendsQuery
} from '#lib/insights.js';
import { RANGES } from '#lib/web.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const update = (change: (query: TrendsQuery) => void) => showQuery(data.query, change);

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

			<FiltersEditor
				filters={data.query.filters}
				properties={allProperties}
				onchange={(filters) => update((q) => (q.filters = filters))}
			/>

			<div class="flex flex-wrap items-center gap-4">
				<BreakdownSelect
					value={data.query.breakdown}
					properties={allProperties}
					onchange={(breakdown) => update((q) => (q.breakdown = breakdown))}
				/>
				<RangePicker
					value={data.query.range}
					onchange={(range) => update((q) => (q.range = range))}
				/>
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
