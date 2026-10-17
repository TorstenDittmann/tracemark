<script lang="ts">
import EventList from '#lib/components/events/event-list.svelte';
import { selectClass, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { type ActivityQuery, LOOKBACK_DAYS } from '#lib/explore.js';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

/** A changed query starts again from the newest events. */
function update(change: (query: ActivityQuery) => void) {
	const next = structuredClone($state.snapshot(data.query)) as ActivityQuery;
	change(next);
	const url = new URL(page.url.href);
	url.searchParams.set('q', JSON.stringify(next));
	url.searchParams.delete('before');
	goto(`${url.pathname}${url.search}`, { reset: false });
}

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
</script>

<svelte:head>
	<title>Events · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<Card.Root class="gap-4">
		<Card.Header>
			<Card.Title>Activity</Card.Title>
			<Card.Description>
				The newest events from the last {LOOKBACK_DAYS} days. Open one to see everything it carried.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<label class="flex items-center gap-2 text-sm">
				<span class="font-medium">Event</span>
				<select
					class={selectClass}
					value={data.query.event ?? ''}
					onchange={(e) =>
						update((q) => {
							const event = e.currentTarget.value;
							if (event) q.event = event;
							else delete q.event;
						})}
				>
					<option value="">All events</option>
					{#each withCurrent(eventOptions, data.query.event) as event (event)}
						<option value={event}>{event}</option>
					{/each}
				</select>
			</label>
			<FiltersEditor
				filters={data.query.filters}
				properties={allProperties}
				onchange={(filters) => update((q) => (q.filters = filters))}
			/>
		</Card.Content>
	</Card.Root>

	{#if !data.activity}
		<p class="text-sm text-muted-foreground">
			Events are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<EventList activity={data.activity} paged={data.paged} projectId={data.project.id} />
	{/if}
</div>
