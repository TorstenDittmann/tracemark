<script lang="ts">
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { RETENTION_RANGES, type RetentionQuery, retentionPeriod } from '#lib/insights.js';
import type { Range } from '#lib/web.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const update = (change: (query: RetentionQuery) => void) => showQuery(data.query, change);

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
const period = $derived(retentionPeriod(data.query.range));
const periodLabel = $derived(period === 'day' ? 'Day' : 'Week');

const cohortFormat = new Intl.DateTimeFormat(undefined, {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

const cohorts = $derived(data.result?.cohorts ?? []);
const periods = $derived(Math.max(0, cohorts.length - 1));
const periodIndexes = $derived(Array.from({ length: periods }, (_, n) => n));

/** Share returning in each period, over the cohorts old enough to have reached it. */
const average = $derived(
	Array.from({ length: periods }, (_, n) => {
		let size = 0;
		let returned = 0;
		for (const cohort of cohorts) {
			if (n < cohort.returned.length) {
				size += cohort.size;
				returned += cohort.returned[n];
			}
		}
		return size ? returned / size : null;
	})
);
const total = $derived(cohorts.reduce((sum, cohort) => sum + cohort.size, 0));

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;
</script>

{#snippet cell(
	share: number | null,
	title: string
)}
	{#if share === null}
		<td class="p-0.5"></td>
	{:else}
		<td class="p-0.5">
			<div
				class={[
					'rounded px-2 py-1.5 text-right tabular-nums',
					share >= 0.5 ? 'text-white' : 'text-foreground'
				]}
				style:background="color-mix(in oklab, var(--series-1) {Math.round(
					share * 100
				)}%, transparent)"
				{title}
			>
				{percent(share)}
			</div>
		</td>
	{/if}
{/snippet}

<svelte:head>
	<title>Retention · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<Card.Root class="gap-4">
		<Card.Header>
			<Card.Title>Retention</Card.Title>
			<Card.Description>
				How many people come back in the {period}s after they first did something.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				<label class="flex items-center gap-2">
					<span class="font-medium">Cohort by first</span>
					<select
						class={selectClass}
						value={data.query.start}
						onchange={(e) => update((q) => (q.start = e.currentTarget.value))}
					>
						{#each withCurrent(eventOptions, data.query.start) as event (event)}
							<option value={event}>{event}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center gap-2">
					<span class="font-medium">Came back with</span>
					<select
						class={selectClass}
						value={data.query.returning}
						onchange={(e) => update((q) => (q.returning = e.currentTarget.value))}
					>
						{#each withCurrent(eventOptions, data.query.returning) as event (event)}
							<option value={event}>{event}</option>
						{/each}
					</select>
				</label>
			</div>
			<FiltersEditor
				filters={data.query.filters}
				properties={allProperties}
				onchange={(filters) => update((q) => (q.filters = filters))}
			/>
			<div>
				<RangePicker
					value={data.query.range}
					ranges={RETENTION_RANGES}
					onchange={(range: Range) => update((q) => (q.range = range === '24h' ? '7d' : range))}
				/>
			</div>
		</Card.Content>
	</Card.Root>

	{#if !data.result}
		<p class="text-sm text-muted-foreground">
			Insights are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<Card.Root class="py-4">
			<Card.Content class="px-4">
				{#if total === 0}
					<p class="py-12 text-center text-sm text-muted-foreground">
						Nobody did {data.query.start} in this range.
					</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full border-separate border-spacing-0 text-sm">
							<thead class="text-xs text-muted-foreground">
								<tr>
									<th class="px-2 py-2 text-left font-normal">Cohort (UTC)</th>
									<th class="px-2 py-2 text-right font-normal">People</th>
									{#each periodIndexes as n (n)}
										<th class="px-2 py-2 text-right font-normal">{periodLabel} {n + 1}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								<tr class="font-medium">
									<td class="px-2 py-1.5">All cohorts</td>
									<td class="px-2 py-1.5 text-right tabular-nums">{total.toLocaleString()}</td>
									{#each average as share, n (n)}
										{@render cell(share, `${periodLabel} ${n + 1}, all cohorts`)}
									{/each}
								</tr>
								{#each cohorts as cohort (cohort.start)}
									{@const label = cohortFormat.format(new Date(cohort.start))}
									<tr>
										<td class="px-2 py-1.5 whitespace-nowrap">
											{period === 'week' ? `Week of ${label}` : label}
										</td>
										<td class="px-2 py-1.5 text-right tabular-nums">
											{cohort.size.toLocaleString()}
										</td>
										{#each periodIndexes as n (n)}
											{@const returned = cohort.returned[n]}
											{@render cell(
												returned === undefined || cohort.size === 0 ? null : returned / cohort.size,
												`${returned ?? 0} of ${cohort.size} people`
											)}
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
