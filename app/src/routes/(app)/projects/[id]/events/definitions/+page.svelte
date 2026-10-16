<script lang="ts">
import * as Card from '#lib/components/ui/card/index.js';
import { LOOKBACK_DAYS } from '#lib/explore.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const base = $derived(`/projects/${data.project.id}`);
const activityHref = (event: string) =>
	`${base}/events?q=${encodeURIComponent(JSON.stringify({ event, filters: [] }))}`;
const propertiesHref = (event: string) =>
	`${base}/events/properties?event=${encodeURIComponent(event)}`;
const trendHref = (event: string) =>
	`${base}/insights/trends?q=${encodeURIComponent(
		JSON.stringify({ series: [{ event, math: 'total' }], range: '30d', filters: [] })
	)}`;
</script>

<svelte:head>
	<title>Event definitions · {data.project.name} · footprint</title>
</svelte:head>

{#if !data.definitions}
	<p class="text-sm text-muted-foreground">
		Events are unavailable because ClickHouse could not be reached.
	</p>
{:else}
	<Card.Root class="min-w-0 py-2">
		{#if data.definitions.length}
			<div class="relative overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Event</th>
							<th class="px-4 py-2 text-right font-normal">Last {LOOKBACK_DAYS} days</th>
							<th class="px-4 py-2 font-normal">First seen</th>
							<th class="px-4 py-2 font-normal">Last seen</th>
							<th class="px-6 py-2"><span class="sr-only">Links</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.definitions as definition (definition.event)}
							<tr class="border-t">
								<td class="px-6 py-2 font-medium break-all">{definition.event}</td>
								<td class="px-4 py-2 text-right tabular-nums">
									{definition.count.toLocaleString()}
								</td>
								<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
									{dateFormat.format(new Date(definition.firstSeen))}
								</td>
								<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
									{dateFormat.format(new Date(definition.lastSeen))}
								</td>
								<td class="px-6 py-2 text-right whitespace-nowrap">
									<a class="hover:underline" href={activityHref(definition.event)}>Activity</a>
									<span class="text-muted-foreground" aria-hidden="true">·</span>
									<a class="hover:underline" href={propertiesHref(definition.event)}>Properties</a>
									<span class="text-muted-foreground" aria-hidden="true">·</span>
									<a class="hover:underline" href={trendHref(definition.event)}>Trend</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="px-6 py-10 text-center text-sm text-muted-foreground">
				No events yet. They show up here as soon as the first one arrives.
			</p>
		{/if}
	</Card.Root>
{/if}
