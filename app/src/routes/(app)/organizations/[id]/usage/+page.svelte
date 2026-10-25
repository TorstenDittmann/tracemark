<script lang="ts">
import ChartColumn from '@lucide/svelte/icons/chart-column';
import StackedBarChart from '#lib/components/charts/stacked-bar-chart.svelte';
import PageHeader from '#lib/components/page-header.svelte';
import RangePicker from '#lib/components/range-picker.svelte';
import StatCard from '#lib/components/stat-card.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { CATEGORY_KEYS, formatBytes, USAGE_CATEGORIES, USAGE_RANGES } from '#lib/usage.js';
import { RANGES } from '#lib/web.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const rangeLabel = $derived(RANGES[data.range].label.toLowerCase());
const volume = $derived(data.volume);
const storage = $derived(data.storage);

const nameOf = (id: string) => data.names[id] ?? id;
const share = (part: number, whole: number) =>
	whole ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '–';

/** Projects with the most events first; those without any last, by name. */
const projects = $derived(
	[...(volume?.projects ?? [])].sort(
		(a, b) => b.total - a.total || nameOf(a.id).localeCompare(nameOf(b.id))
	)
);
const series = $derived(
	projects
		.filter((p) => p.total > 0)
		.map((p) => ({ key: p.id, label: nameOf(p.id), data: p.daily }))
);
const categories = $derived(
	CATEGORY_KEYS.map((key) => ({
		key,
		...USAGE_CATEGORIES[key],
		count: volume?.categories[key] ?? 0
	})).sort((a, b) => b.count - a.count)
);
const tracemarkBytes = $derived(
	(storage?.tables ?? [])
		.filter((t) => t.database === storage?.database)
		.reduce((sum, t) => sum + t.compressedBytes, 0)
);
const retentionDocs =
	'https://github.com/TorstenDittmann/tracemark/blob/main/docs/privacy.md#retention';
</script>

<svelte:head>
	<title>Usage · {data.organization.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<PageHeader
		title="Usage"
		description="Events stored in this organization's projects, by the day they arrived (UTC)."
		icon={ChartColumn}
	>
		{#snippet actions()}
			<RangePicker current={data.range} ranges={USAGE_RANGES} />
		{/snippet}
	</PageHeader>

	{#if !volume}
		<p class="text-sm text-muted-foreground">
			Usage is unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-3">
			<StatCard
				label="Events"
				value={volume.total.toLocaleString()}
				hint={RANGES[data.range].label}
			/>
			<StatCard
				label="Per day"
				value={Math.round(volume.total / volume.buckets.length).toLocaleString()}
				hint="Average over the range"
			/>
			{#if storage}
				<StatCard
					label="Tracemark on disk"
					value={formatBytes(tracemarkBytes)}
					hint="All organizations, compressed"
				/>
			{:else}
				<StatCard
					label="Projects"
					value={projects.filter((p) => p.total > 0).length.toLocaleString()}
					hint="With events in the range"
				/>
			{/if}
		</div>

		<Card.Root class="min-w-0">
			<Card.Header>
				<Card.Title>Events per day</Card.Title>
				<Card.Description>Stacked by project.</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if series.length}
					<StackedBarChart {series} buckets={volume.buckets} />
				{:else}
					<p class="text-sm text-muted-foreground">No events stored in the {rangeLabel}.</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<div class="grid gap-6 lg:grid-cols-2">
			<Card.Root class="min-w-0 gap-3 pb-0">
				<Card.Header>
					<Card.Title>By project</Card.Title>
					{#if storage}
						<Card.Description>
							Storage is an estimate: the project's share of all stored events times the events
							table's size on disk.
						</Card.Description>
					{/if}
				</Card.Header>
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<caption class="sr-only">
							Events by project in the {rangeLabel}
						</caption>
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">Project</th>
								<th class="px-4 py-2 text-right font-normal">Events</th>
								<th class="px-4 py-2 text-right font-normal">Share</th>
								{#if storage}
									<th class="px-6 py-2 text-right font-normal whitespace-nowrap">Est. storage</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each projects as project (project.id)}
								<tr class="border-t">
									<td class="max-w-[12rem] px-6 py-2 sm:max-w-[20rem]">
										<a
											href="/projects/{project.id}"
											class="block truncate font-medium hover:underline"
											title={nameOf(project.id)}
											>{nameOf(project.id)}</a
										>
									</td>
									<td class="px-4 py-2 text-right tabular-nums">
										{project.total.toLocaleString()}
									</td>
									<td class="px-4 py-2 text-right text-muted-foreground tabular-nums">
										{share(project.total, volume.total)}
									</td>
									{#if storage}
										<td class="px-6 py-2 text-right whitespace-nowrap tabular-nums">
											~{formatBytes(storage.estimates[project.id] ?? 0)}
										</td>
									{/if}
								</tr>
							{:else}
								<tr class="border-t">
									<td colspan="4" class="px-6 py-4 text-muted-foreground">
										This organization has no projects yet.
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Card.Root>

			<Card.Root class="min-w-0 gap-3 pb-0">
				<Card.Header>
					<Card.Title>By category</Card.Title>
					<Card.Description>What the events are, across all projects.</Card.Description>
				</Card.Header>
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<caption class="sr-only">
							Events by category in the {rangeLabel}
						</caption>
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">Category</th>
								<th class="px-4 py-2 text-right font-normal">Events</th>
								<th class="px-6 py-2 text-right font-normal">Share</th>
							</tr>
						</thead>
						<tbody>
							{#each categories as category (category.key)}
								<tr class="border-t">
									<td class="px-6 py-2">
										<span class="block font-medium">{category.label}</span>
										<span class="block text-xs text-muted-foreground">{category.events}</span>
									</td>
									<td class="px-4 py-2 text-right tabular-nums">
										{category.count.toLocaleString()}
									</td>
									<td class="px-6 py-2 text-right text-muted-foreground tabular-nums">
										{share(category.count, volume.total)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Card.Root>
		</div>

		{#if data.manager}
			<Card.Root class="min-w-0 gap-3 pb-0">
				<Card.Header>
					<Card.Title>ClickHouse storage</Card.Title>
					<Card.Description>
						Every table on the ClickHouse server, not just this organization's, from active parts in
						<code>system.parts</code>. Only owners and admins see this.
					</Card.Description>
				</Card.Header>
				{#if storage}
					<div class="relative overflow-x-auto">
						<table class="data-table w-full text-sm">
							<caption class="sr-only">
								ClickHouse disk use by table
							</caption>
							<thead class="text-left text-xs text-muted-foreground">
								<tr>
									<th class="px-6 py-2 font-normal">Table</th>
									<th class="px-4 py-2 text-right font-normal">Rows</th>
									<th class="hidden px-4 py-2 text-right font-normal sm:table-cell">Parts</th>
									<th class="px-4 py-2 text-right font-normal whitespace-nowrap">On disk</th>
									<th class="hidden px-6 py-2 text-right font-normal sm:table-cell">
										Uncompressed
									</th>
								</tr>
							</thead>
							<tbody>
								{#each storage.tables as table (`${table.database}.${table.table}`)}
									<tr class="border-t">
										<td class="max-w-[14rem] px-6 py-2 sm:max-w-[24rem]">
											<span class="block truncate font-medium" title={table.table}
												>{table.table}</span
											>
											<span class="block truncate text-xs text-muted-foreground">
												{table.database}{table.database === storage.database ? ' (Tracemark)' : ''}
											</span>
										</td>
										<td class="px-4 py-2 text-right tabular-nums">{table.rows.toLocaleString()}</td>
										<td class="hidden px-4 py-2 text-right tabular-nums sm:table-cell">
											{table.parts.toLocaleString()}
										</td>
										<td class="px-4 py-2 text-right whitespace-nowrap tabular-nums">
											{formatBytes(table.compressedBytes)}
										</td>
										<td
											class="hidden px-6 py-2 text-right text-muted-foreground tabular-nums sm:table-cell"
										>
											{formatBytes(table.uncompressedBytes)}
										</td>
									</tr>
								{:else}
									<tr class="border-t">
										<td colspan="5" class="px-6 py-4 text-muted-foreground">
											No tables with data yet.
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<Card.Content class="pb-6">
						<p class="text-sm text-muted-foreground">
							Storage is hidden because Tracemark's ClickHouse user can't read
							<code>system.parts</code>. Grant it <code>SELECT ON system.parts</code> to see disk
							use here.
						</p>
					</Card.Content>
				{/if}
			</Card.Root>
		{/if}
	{/if}

	<p class="text-sm text-muted-foreground">
		To use less disk, set a retention period in each project's
		<strong>Settings → Data retention</strong>; older events are deleted every few hours. See
		<a href={retentionDocs} class="underline underline-offset-4 hover:text-foreground"
			>docs/privacy.md</a
		>.
	</p>
</div>
