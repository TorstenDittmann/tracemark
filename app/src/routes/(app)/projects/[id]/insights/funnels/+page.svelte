<script lang="ts">
import BreakdownSelect from '#lib/components/insights/breakdown-select.svelte';
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import FunnelView from '#lib/components/insights/funnel-view.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import SaveInsight from '#lib/components/insights/save-insight.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import {
	type ConversionWindow,
	type FunnelQuery,
	MAX_STEPS,
	MIN_STEPS,
	WINDOWS
} from '#lib/insights.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const update = (change: (query: FunnelQuery) => void) => showQuery(data.query, change);

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
</script>

<svelte:head>
	<title>Funnels · {data.project.name} · footprint</title>
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
			<Card.Title>Funnel</Card.Title>
			<Card.Description>
				People who did each step after the one before, within the conversion window.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<section class="grid gap-2">
				<h3 class="text-sm font-medium">Steps</h3>
				<ol class="grid gap-2">
					{#each data.query.steps as step, i (i)}
						<li class="flex flex-wrap items-center gap-2">
							<span class="w-5 text-right text-sm text-muted-foreground tabular-nums"
								>{i + 1}.</span
							>
							<select
								class={selectClass}
								aria-label="Step {i + 1} event"
								value={step}
								onchange={(e) => update((q) => (q.steps[i] = e.currentTarget.value))}
							>
								{#each withCurrent(eventOptions, step) as event (event)}
									<option value={event}>{event}</option>
								{/each}
							</select>
							{#if data.query.steps.length > MIN_STEPS}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => update((q) => q.steps.splice(i, 1))}
									aria-label="Remove step {i + 1}"
								>
									Remove
								</Button>
							{/if}
						</li>
					{/each}
				</ol>
				{#if data.query.steps.length < MAX_STEPS}
					<div>
						<Button
							variant="outline"
							size="sm"
							onclick={() => update((q) => q.steps.push(eventOptions[0] ?? '$pageview'))}
						>
							Add step
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
				<label class="flex items-center gap-2 text-sm">
					<span class="font-medium">Conversion window</span>
					<select
						class={selectClass}
						value={data.query.window}
						onchange={(e) => update((q) => (q.window = e.currentTarget.value as ConversionWindow))}
					>
						{#each Object.entries(WINDOWS) as [value, { label }] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</label>
				<BreakdownSelect
					label="Breakdown by first step"
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
		<Card.Root class="min-w-0">
			<Card.Content>
				<FunnelView result={data.result} breakdown={data.query.breakdown} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
