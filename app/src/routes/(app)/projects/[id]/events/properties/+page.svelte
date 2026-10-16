<script lang="ts">
import { selectClass, withCurrent } from '#lib/components/insights/editor.svelte.js';
import * as Card from '#lib/components/ui/card/index.js';
import { LOOKBACK_DAYS } from '#lib/explore.js';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

function showEvent(event: string) {
	const url = new URL(page.url.href);
	if (event) url.searchParams.set('event', event);
	else url.searchParams.delete('event');
	goto(`${url.pathname}${url.search}`, { reset: false });
}

const eventOptions = $derived(data.events.map((e) => e.event));
const activityHref = (property: string) =>
	`/projects/${data.project.id}/events?q=${encodeURIComponent(
		JSON.stringify({
			...(data.event ? { event: data.event } : {}),
			filters: [{ property, operator: 'is_set' }]
		})
	)}`;
</script>

<svelte:head>
	<title>Properties · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<label class="flex items-center gap-2 text-sm">
		<span class="font-medium">Properties of</span>
		<select
			class={selectClass}
			value={data.event ?? ''}
			onchange={(e) => showEvent(e.currentTarget.value)}
		>
			<option value="">All events</option>
			{#each withCurrent(eventOptions, data.event) as event (event)}
				<option value={event}>{event}</option>
			{/each}
		</select>
	</label>

	{#if !data.definitions}
		<p class="text-sm text-muted-foreground">
			Properties are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<Card.Root class="min-w-0 py-2">
			{#if data.definitions.length}
				<div class="relative overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">Property</th>
								<th class="px-4 py-2 font-normal">Type</th>
								<th class="px-4 py-2 text-right font-normal">
									Events with it, last {LOOKBACK_DAYS} days
								</th>
								<th class="px-6 py-2"><span class="sr-only">Links</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.definitions as definition (definition.name)}
								<tr class="border-t">
									<td class="px-6 py-2 font-medium break-all">{definition.name}</td>
									<td class="px-4 py-2 text-muted-foreground">{definition.types.join(', ')}</td>
									<td class="px-4 py-2 text-right tabular-nums">
										{definition.count.toLocaleString()}
									</td>
									<td class="px-6 py-2 text-right">
										<a class="hover:underline" href={activityHref(definition.name)}>Activity</a>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="px-6 py-10 text-center text-sm text-muted-foreground">
					No properties seen in the last {LOOKBACK_DAYS} days.
				</p>
			{/if}
		</Card.Root>
	{/if}
</div>
