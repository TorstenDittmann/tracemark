<script lang="ts">
import Filter from '@lucide/svelte/icons/filter';
import LineChart from '#lib/components/charts/line-chart.svelte';
import StatCard from '#lib/components/stat-card.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { DIMENSIONS, type Dimension, RANGES, type Range } from '#lib/web.js';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const ranges = Object.keys(RANGES) as Range[];

type Metric = 'visitors' | 'pageviews';
let metric = $state<Metric>('visitors');

const panels: { title: string; tabs: { dimension: Dimension; label: string }[] }[] = [
	{
		title: 'Pages',
		tabs: [
			{ dimension: 'page', label: 'Top pages' },
			{ dimension: 'entry', label: 'Entry' },
			{ dimension: 'exit', label: 'Exit' }
		]
	},
	{
		title: 'Sources',
		tabs: [
			{ dimension: 'referrer', label: 'Referrers' },
			{ dimension: 'utm_source', label: 'Source' },
			{ dimension: 'utm_medium', label: 'Medium' },
			{ dimension: 'utm_campaign', label: 'Campaign' }
		]
	},
	{ title: 'Locations', tabs: [{ dimension: 'country', label: 'Countries' }] },
	{
		title: 'Devices',
		tabs: [
			{ dimension: 'device', label: 'Device' },
			{ dimension: 'browser', label: 'Browser' },
			{ dimension: 'os', label: 'OS' }
		]
	}
];
let selected = $state<Record<string, Dimension>>({});

const regions = new Intl.DisplayNames(undefined, { type: 'region' });

function display(dimension: Dimension, value: string): string {
	if (value === '') {
		if (dimension === 'referrer') return 'Direct';
		if (dimension.startsWith('utm_')) return 'None';
		return 'Unknown';
	}
	if (dimension === 'country') {
		try {
			return regions.of(value) ?? value;
		} catch {
			return value;
		}
	}
	return value;
}

/** The current URL with some query parameters set (string) or removed (null). */
function href(changes: Record<string, string | null>): string {
	const url = new URL(page.url.href);
	for (const [key, value] of Object.entries(changes)) {
		if (value === null) url.searchParams.delete(key);
		else url.searchParams.set(key, value);
	}
	return `${url.pathname}${url.search}`;
}

/** The flag emoji for a two-letter country code. */
function flag(code: string): string {
	if (!/^[A-Z]{2}$/.test(code)) return '';
	return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function duration(seconds: number): string {
	const s = Math.round(seconds);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const activeFilters = $derived(
	(Object.entries(data.filters) as [Dimension, string][]).map(([dimension, value]) => ({
		dimension,
		value
	}))
);

const tiles = $derived(
	data.web
		? [
				{
					label: 'Visitors',
					value: data.web.overview.visitors.toLocaleString(),
					trend: data.web.series.map((point) => point.visitors)
				},
				{
					label: 'Page views',
					value: data.web.overview.pageviews.toLocaleString(),
					trend: data.web.series.map((point) => point.pageviews)
				},
				{ label: 'Sessions', value: data.web.overview.sessions.toLocaleString() },
				{
					label: 'Bounce rate',
					value: `${Math.round(data.web.overview.bounceRate * 100)}%`
				},
				{ label: 'Visit duration', value: duration(data.web.overview.avgDuration) }
			]
		: []
);

const metrics: { key: Metric; label: string }[] = [
	{ key: 'visitors', label: 'Visitors' },
	{ key: 'pageviews', label: 'Page views' }
];
</script>

<svelte:head>
	<title>Web analytics · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<div class="flex flex-wrap items-center gap-2">
		<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
			<legend class="sr-only">Date range</legend>
			{#each ranges as range (range)}
				<a
					href={href({ range })}
					title={RANGES[range].label}
					aria-current={data.range === range ? 'true' : undefined}
					class={[
						'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
						data.range === range
							? 'bg-background text-foreground shadow-sm dark:bg-input/40'
							: 'text-muted-foreground hover:text-foreground'
					]}
				>
					{range}
				</a>
			{/each}
		</fieldset>
		{#each activeFilters as filter (filter.dimension)}
			<a
				href={href({ [filter.dimension]: null })}
				class="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-sm hover:bg-accent"
				aria-label="Remove filter {DIMENSIONS[filter.dimension]} is {display(
					filter.dimension,
					filter.value
				)}"
			>
				<span class="text-muted-foreground">{DIMENSIONS[filter.dimension]}</span>
				<span class="font-medium">{display(filter.dimension, filter.value)}</span>
				<span aria-hidden="true" class="text-muted-foreground">×</span>
			</a>
		{/each}
		{#if activeFilters.length > 1}
			<a
				href={href(Object.fromEntries(activeFilters.map((f) => [f.dimension, null])))}
				class="text-sm text-muted-foreground hover:text-foreground"
			>
				Clear filters
			</a>
		{/if}
	</div>

	{#if !data.web}
		<p class="text-sm text-muted-foreground">
			Web analytics are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
			{#each tiles as tile (tile.label)}
				<StatCard label={tile.label} value={tile.value} trend={tile.trend} />
			{/each}
		</div>

		<Card.Root class="gap-4">
			<Card.Header class="flex flex-row items-center justify-between gap-2">
				<Card.Title>{metric === 'visitors' ? 'Visitors' : 'Page views'}</Card.Title>
				<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
					<legend class="sr-only">Metric</legend>
					{#each metrics as m (m.key)}
						<button
							type="button"
							onclick={() => (metric = m.key)}
							aria-pressed={metric === m.key}
							class={[
								'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
								metric === m.key
									? 'bg-background text-foreground shadow-sm dark:bg-input/40'
									: 'text-muted-foreground hover:text-foreground'
							]}
						>
							{m.label}
						</button>
					{/each}
				</fieldset>
			</Card.Header>
			<Card.Content>
				<LineChart
					lines={[
						{
							key: metric,
							label: metric === 'visitors' ? 'Visitors' : 'Page views',
							data: data.web.series.map((point) => point[metric])
						}
					]}
					buckets={data.web.series.map((point) => point.t)}
					bucket={data.web.bucket}
				/>
			</Card.Content>
		</Card.Root>

		<div class="grid gap-4 md:grid-cols-2">
			{#each panels as panel (panel.title)}
				{@const dimension = selected[panel.title] ?? panel.tabs[0].dimension}
				{@const rows = data.web.breakdowns[dimension]}
				{@const max = Math.max(1, ...rows.map((row) => row.visitors))}
				<Card.Root class="gap-3">
					<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
						<Card.Title>{panel.title}</Card.Title>
						{#if panel.tabs.length > 1}
							<fieldset class="inline-flex flex-wrap rounded-lg bg-muted p-0.5 text-xs">
								<legend class="sr-only">{panel.title} breakdown</legend>
								{#each panel.tabs as tab (tab.dimension)}
									<button
										type="button"
										onclick={() => (selected[panel.title] = tab.dimension)}
										aria-pressed={dimension === tab.dimension}
										class={[
											'rounded-md px-2 py-0.5 font-medium transition-all duration-200',
											dimension === tab.dimension
												? 'bg-background text-foreground shadow-sm dark:bg-input/40'
												: 'text-muted-foreground hover:text-foreground'
										]}
									>
										{tab.label}
									</button>
								{/each}
							</fieldset>
						{/if}
					</Card.Header>
					<Card.Content class="grid gap-1 text-sm">
						<div class="flex justify-between px-2 text-xs text-muted-foreground">
							<span>{DIMENSIONS[dimension]}</span>
							<span>Visitors</span>
						</div>
						{#each rows as row (row.value)}
							{@const filtered = data.filters[dimension] === row.value}
							<a
								href={href({ [dimension]: filtered ? null : row.value })}
								title={filtered ? 'Remove filter' : `Filter by ${DIMENSIONS[dimension]}`}
								class={[
									'group relative flex items-center justify-between gap-4 overflow-hidden rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
									filtered && 'ring-1 ring-primary/40'
								]}
							>
								<span
									class="absolute inset-y-0 left-0 rounded-md bg-primary/10 transition-[width,background-color] duration-700 ease-out group-hover:bg-primary/15"
									style:width="{(row.visitors / max) * 100}%"
									aria-hidden="true"
								></span>
								<span class="relative flex min-w-0 items-center gap-2 truncate">
									{#if dimension === 'country' && row.value}
										<span aria-hidden="true">{flag(row.value)}</span>
									{/if}
									<span class="truncate">{display(dimension, row.value)}</span>
								</span>
								<span class="relative flex items-center gap-2 tabular-nums">
									<Filter
										class="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
										aria-hidden="true"
									/>
									{row.visitors.toLocaleString()}
								</span>
							</a>
						{:else}
							<p class="px-2 py-6 text-center text-muted-foreground">No data for this range</p>
						{/each}
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
