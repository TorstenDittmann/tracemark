<script lang="ts">
import CohortSelect from '#lib/components/insights/cohort-select.svelte';
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import InternalUsersToggle from '#lib/components/insights/internal-users-toggle.svelte';
import LifecycleView from '#lib/components/insights/lifecycle-view.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import SaveInsight from '#lib/components/insights/save-insight.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import {
	LIFECYCLE_INTERVALS,
	LIFECYCLE_RANGES,
	type LifecycleInterval,
	type LifecycleQuery
} from '#lib/insights.js';
import type { Range } from '#lib/web.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const update = (change: (query: LifecycleQuery) => void) => showQuery(data.query, change);

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
const interval = $derived(data.query.interval);
</script>

<svelte:head>
	<title>Lifecycle · {data.project.name} · Tracemark</title>
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
			<Card.Title>Lifecycle</Card.Title>
			<Card.Description>
				Who is active each {interval}: new people doing it for the first time, people returning from
				the {interval} before, and people resurrecting after a break. Dormant people were active the
				{interval}
				before but not this one, and count below zero.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				<label class="flex items-center gap-2">
					<span class="font-medium">Active means did</span>
					<select
						class={selectClass}
						value={data.query.event}
						onchange={(e) => update((q) => (q.event = e.currentTarget.value))}
					>
						{#each withCurrent(eventOptions, data.query.event) as event (event)}
							<option value={event}>{event}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center gap-2">
					<span class="font-medium">Per</span>
					<select
						class={selectClass}
						value={interval}
						onchange={(e) =>
							update((q) => (q.interval = e.currentTarget.value as LifecycleInterval))}
					>
						{#each Object.entries(LIFECYCLE_INTERVALS) as [value, label] (value)}
							<option {value}>{label}</option>
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
			<InternalUsersToggle
				value={data.query.filterInternal}
				project={data.project}
				onchange={(filter) => update((q) => (q.filterInternal = filter))}
			/>
			<div>
				<RangePicker
					value={data.query.range}
					ranges={LIFECYCLE_RANGES}
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
				<LifecycleView result={data.result} event={data.query.event} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
