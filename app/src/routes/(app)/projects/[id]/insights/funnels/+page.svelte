<script lang="ts">
import BreakdownSelect from '#lib/components/insights/breakdown-select.svelte';
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
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

let { data }: PageProps = $props();

const update = (change: (query: FunnelQuery) => void) => showQuery(data.query, change);

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));

const percent = (part: number, whole: number) =>
	whole === 0 ? '0%' : `${Math.round((part / whole) * 1000) / 10}%`;

const counts = $derived(data.result?.total.counts ?? []);
const entered = $derived(counts[0] ?? 0);
</script>

<svelte:head>
	<title>Funnels · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
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
		<Card.Root class="gap-4">
			<Card.Header>
				<Card.Description>Converted</Card.Description>
				<Card.Title class="text-3xl tabular-nums">
					{percent(counts.at(-1) ?? 0, entered)}
				</Card.Title>
				<Card.Description>
					{(counts.at(-1) ?? 0).toLocaleString()}
					of {entered.toLocaleString()} people who entered
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if entered === 0}
					<p class="py-12 text-center text-sm text-muted-foreground">
						Nobody did the first step in this range.
					</p>
				{:else}
					<ol
						class="grid gap-3"
						style:grid-template-columns="repeat({data.result.steps.length}, minmax(0, 1fr))"
					>
						{#each data.result.steps as step, i (i)}
							{@const count = counts[i]}
							<li class="grid min-w-0 gap-2 text-sm">
								<div class="truncate">
									<span class="font-medium tabular-nums">{count.toLocaleString()}</span>
									<span class="text-muted-foreground">· {percent(count, entered)}</span>
								</div>
								<div
									class="relative h-48 overflow-hidden rounded bg-muted"
									title="{step}: {count.toLocaleString()} people, {percent(
										count,
										entered
									)} of entered"
								>
									<div
										class="absolute inset-x-0 bottom-0 rounded bg-series-1"
										style:height="{(count / entered) * 100}%"
									></div>
								</div>
								<div class="min-w-0">
									<div class="truncate font-medium" title={step}>{i + 1}. {step}</div>
									{#if i > 0}
										<div class="text-xs text-muted-foreground">
											{percent(count, counts[i - 1])}
											of previous
										</div>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if data.result.groups.length}
			<Card.Root class="py-2">
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">{data.query.breakdown}</th>
								{#each data.result.steps as step, i (i)}
									<th class="px-4 py-2 text-right font-normal">{i + 1}. {step}</th>
								{/each}
								<th class="px-6 py-2 text-right font-normal">Converted</th>
							</tr>
						</thead>
						<tbody>
							{#each data.result.groups as group (group.breakdown)}
								<tr class="border-t">
									<td class="px-6 py-2">{group.breakdown || 'None'}</td>
									{#each group.counts as count, i (i)}
										<td class="px-4 py-2 text-right tabular-nums">{count.toLocaleString()}</td>
									{/each}
									<td class="px-6 py-2 text-right font-medium tabular-nums">
										{percent(group.counts.at(-1) ?? 0, group.counts[0])}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Card.Root>
		{/if}
	{/if}
</div>
