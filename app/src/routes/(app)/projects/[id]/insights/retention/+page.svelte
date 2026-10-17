<script lang="ts">
import CohortSelect from '#lib/components/insights/cohort-select.svelte';
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import RetentionView from '#lib/components/insights/retention-view.svelte';
import SaveInsight from '#lib/components/insights/save-insight.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { RETENTION_RANGES, type RetentionQuery, retentionPeriod } from '#lib/insights.js';
import type { Range } from '#lib/web.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const update = (change: (query: RetentionQuery) => void) => showQuery(data.query, change);

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
</script>

<svelte:head>
	<title>Retention · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<SaveInsight
		query={data.query}
		saved={data.saved}
		dashboards={data.dashboards}
		dashboardsHref="/projects/{data.project.id}/dashboards"
		{form}
	/>
	<Card.Root class="gap-4">
		<Card.Header>
			<Card.Title>Retention</Card.Title>
			<Card.Description>
				How many people come back in the {retentionPeriod(data.query.range)}s after they first did
				something.
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
			<CohortSelect
				value={data.query.cohort}
				cohorts={data.cohorts}
				onchange={(cohort) =>
					update((q) => {
						if (cohort) q.cohort = cohort;
						else delete q.cohort;
					})}
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
		<Card.Root class="min-w-0 py-4">
			<Card.Content class="px-4">
				<RetentionView result={data.result} start={data.query.start} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
