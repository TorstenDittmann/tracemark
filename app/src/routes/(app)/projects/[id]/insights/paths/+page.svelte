<script lang="ts">
import CohortSelect from '#lib/components/insights/cohort-select.svelte';
import { selectClass, showQuery, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import PathsView from '#lib/components/insights/paths-view.svelte';
import RangePicker from '#lib/components/insights/range-picker.svelte';
import SaveInsight from '#lib/components/insights/save-insight.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import {
	MAX_PATH_STEPS,
	MIN_PATH_STEPS,
	PATH_LABELS,
	type PathLabel,
	type PathsQuery
} from '#lib/insights.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const update = (change: (query: PathsQuery) => void) => showQuery(data.query, change);

const options = $derived(
	data.query.label === 'page'
		? data.pages
		: data.events.map((e) => e.event).filter((event) => event !== '$pageleave')
);
const allProperties = $derived(data.properties.map((p) => p.name));
const stepCounts = Array.from(
	{ length: MAX_PATH_STEPS - MIN_PATH_STEPS + 1 },
	(_, i) => MIN_PATH_STEPS + i
);

/** Sets or clears the start or end. */
function setPoint(key: 'start' | 'end', value: string) {
	update((q) => {
		if (value) q[key] = value;
		else delete q[key];
	});
}
</script>

<svelte:head>
	<title>Paths · {data.project.name} · Tracemark</title>
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
			<Card.Title>Paths</Card.Title>
			<Card.Description>
				What people do in a session after, or before, a page or event. Each step keeps its 8 most
				common {data.query.label === 'page' ? 'pages' : 'events'} and groups the rest as other.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
					<legend class="sr-only">Steps are</legend>
					{#each Object.entries(PATH_LABELS) as [label, title] (label)}
						<button
							type="button"
							aria-pressed={data.query.label === label}
							onclick={() =>
								update((q) => {
									// A page path is no event name, and the other way round.
									if (q.label !== label) {
										delete q.start;
										delete q.end;
									}
									q.label = label as PathLabel;
								})}
							class={[
								'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
								data.query.label === label
									? 'bg-background text-foreground shadow-sm dark:bg-input/40'
									: 'text-muted-foreground hover:text-foreground'
							]}
						>
							{title}
						</button>
					{/each}
				</fieldset>
				<label class="flex items-center gap-2">
					<span class="font-medium">Starting at</span>
					<select
						class={[selectClass, 'max-w-64']}
						value={data.query.start ?? ''}
						onchange={(e) => setPoint('start', e.currentTarget.value)}
					>
						<option value="">The session start</option>
						{#each withCurrent(options, data.query.start) as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center gap-2">
					<span class="font-medium">Ending at</span>
					<select
						class={[selectClass, 'max-w-64']}
						value={data.query.end ?? ''}
						onchange={(e) => setPoint('end', e.currentTarget.value)}
					>
						<option value="">Anywhere</option>
						{#each withCurrent(options, data.query.end) as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center gap-2">
					<span class="font-medium">Steps</span>
					<select
						class={selectClass}
						value={String(data.query.steps)}
						onchange={(e) => update((q) => (q.steps = Number(e.currentTarget.value)))}
					>
						{#each stepCounts as n (n)}
							<option value={String(n)}>{n}</option>
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
		<Card.Root class="min-w-0 py-4">
			<Card.Content class="px-4">
				<PathsView result={data.result} countBack={!data.query.start && !!data.query.end} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
