<script lang="ts">
import CohortSelect from '#lib/components/insights/cohort-select.svelte';
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import InternalUsersToggle from '#lib/components/insights/internal-users-toggle.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import SaveInsight from '#lib/components/insights/save-insight.svelte';
import StickinessView from '#lib/components/insights/stickiness-view.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Checkbox } from '#lib/components/ui/checkbox/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import {
	MAX_SERIES,
	STICKINESS_INTERVALS,
	STICKINESS_RANGES,
	type StickinessInterval,
	type StickinessQuery
} from '#lib/insights.js';
import type { Range } from '#lib/web.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const update = (change: (query: StickinessQuery) => void) => showQuery(data.query, change);

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
const interval = $derived(data.query.interval);
</script>

<svelte:head>
	<title>Stickiness · {data.project.name} · Tracemark</title>
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
			<Card.Title>Stickiness</Card.Title>
			<Card.Description>
				How many people did an event on exactly 1, 2, 3 or more {interval}s of the range. Sticky
				features have people coming back on many {interval}s.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<section class="grid gap-2">
				<h3 class="text-sm font-medium">Events</h3>
				{#each data.query.events as event, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="size-2.5 shrink-0 rounded-full"
							style:background="var(--series-{(i % 8) + 1})"
							aria-hidden="true"
						></span>
						<select
							class={selectClass}
							aria-label="Event"
							value={event}
							onchange={(e) => update((q) => (q.events[i] = e.currentTarget.value))}
						>
							{#each withCurrent(eventOptions, event) as name (name)}
								<option value={name}>{name}</option>
							{/each}
						</select>
						{#if data.query.events.length > 1}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => update((q) => q.events.splice(i, 1))}
								aria-label="Remove event"
							>
								Remove
							</Button>
						{/if}
					</div>
				{/each}
				{#if data.query.events.length < MAX_SERIES}
					<div>
						<Button
							variant="outline"
							size="sm"
							onclick={() => update((q) => q.events.push(eventOptions[0] ?? '$pageview'))}
						>
							Add event
						</Button>
					</div>
				{/if}
			</section>
			<label class="flex items-center gap-2 text-sm">
				<span class="font-medium">Count active</span>
				<select
					class={selectClass}
					value={interval}
					onchange={(e) =>
						update((q) => (q.interval = e.currentTarget.value as StickinessInterval))}
				>
					{#each Object.entries(STICKINESS_INTERVALS) as [value, label] (value)}
						<option {value}>{label}s</option>
					{/each}
				</select>
			</label>
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
			<div class="flex flex-wrap items-center gap-4">
				<RangePicker
					value={data.query.range}
					ranges={STICKINESS_RANGES}
					onchange={(range: Range) => update((q) => (q.range = range === '24h' ? '7d' : range))}
				/>
				<Label class="flex items-center gap-2 text-sm font-normal">
					<Checkbox
						checked={data.query.cumulative}
						onCheckedChange={(checked) => update((q) => (q.cumulative = checked))}
					/>
					Cumulative: N or more {interval}s
				</Label>
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
				<StickinessView result={data.result} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
