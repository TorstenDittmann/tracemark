<script lang="ts">
import { selectClass, withCurrent } from '#lib/components/insights/editor.svelte.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { type ActivityQuery, formatCursor, LOOKBACK_DAYS } from '#lib/explore.js';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const timeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'medium'
});

/** A changed query starts again from the newest events. */
function update(change: (query: ActivityQuery) => void) {
	const next = structuredClone($state.snapshot(data.query)) as ActivityQuery;
	change(next);
	const url = new URL(page.url.href);
	url.searchParams.set('q', JSON.stringify(next));
	url.searchParams.delete('before');
	goto(`${url.pathname}${url.search}`, { reset: false });
}

function pageHref(before: string | null): string {
	const url = new URL(page.url.href);
	if (before) url.searchParams.set('before', before);
	else url.searchParams.delete('before');
	return `${url.pathname}${url.search}`;
}

function display(value: unknown): string {
	return typeof value === 'string' ? value : JSON.stringify(value);
}

/** What a row shows under the event name: the page for page events, otherwise nothing. */
function where(properties: Record<string, unknown>): string {
	const path = properties.$pathname ?? properties.$current_url;
	return typeof path === 'string' ? path : '';
}

const eventOptions = $derived(data.events.map((e) => e.event));
const allProperties = $derived(data.properties.map((p) => p.name));
</script>

<svelte:head>
	<title>Events · {data.project.name} · footprint</title>
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
		<Card.Root class="gap-0 py-0">
			{#if data.activity.events.length}
				<div
					class="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)] gap-4 px-6 py-2 text-xs text-muted-foreground sm:grid"
					aria-hidden="true"
				>
					<span>Event</span>
					<span>Person</span>
					<span class="text-right">Time</span>
				</div>
				<ul>
					{#each data.activity.events as event (event.uuid)}
						{@const path = where(event.properties)}
						{@const entries = Object.entries(event.properties).sort(([a], [b]) =>
							a < b ? -1 : a > b ? 1 : 0
						)}
						<li class="border-t">
							<details class="group">
								<summary
									class="grid cursor-pointer list-none gap-x-4 gap-y-0.5 px-6 py-2.5 text-sm hover:bg-muted/50 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)] [&::-webkit-details-marker]:hidden"
								>
									<span class="min-w-0">
										<span class="block truncate font-medium">{event.event}</span>
										{#if path}
											<span class="block truncate text-xs text-muted-foreground">{path}</span>
										{/if}
									</span>
									<span class="min-w-0 truncate text-muted-foreground" title={event.person}>
										{event.person}
									</span>
									<time
										class="text-muted-foreground tabular-nums sm:text-right"
										datetime={event.timestamp}
									>
										{timeFormat.format(new Date(event.timestamp))}
									</time>
								</summary>
								<div class="grid gap-4 bg-muted/30 px-6 py-4 text-sm">
									<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
										<dt class="text-muted-foreground">Distinct id</dt>
										<dd class="break-all">{event.distinctId}</dd>
										{#if event.person !== event.distinctId}
											<dt class="text-muted-foreground">Person</dt>
											<dd class="break-all">{event.person}</dd>
										{/if}
										{#if event.sessionId}
											<dt class="text-muted-foreground">Session</dt>
											<dd class="break-all">{event.sessionId}</dd>
										{/if}
										<dt class="text-muted-foreground">Time (UTC)</dt>
										<dd>{event.timestamp}</dd>
										<dt class="text-muted-foreground">Event id</dt>
										<dd class="break-all">{event.uuid}</dd>
									</dl>
									{#if entries.length}
										<table class="w-full text-left">
											<caption class="pb-1 text-left text-xs font-medium text-muted-foreground">
												Properties
											</caption>
											<tbody>
												{#each entries as [key, value] (key)}
													<tr class="border-t first:border-t-0">
														<th scope="row" class="w-1/3 py-1 pr-4 align-top font-normal break-all">
															{key}
														</th>
														<td class="py-1 font-mono text-xs break-all">{display(value)}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									{:else}
										<p class="text-muted-foreground">No properties.</p>
									{/if}
								</div>
							</details>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="px-6 py-10 text-center text-sm text-muted-foreground">
					{data.paged ? 'No older events.' : 'No events match.'}
				</p>
			{/if}
			{#if data.paged || data.activity.next}
				<div class="flex justify-between gap-2 border-t px-6 py-3">
					{#if data.paged}
						<Button variant="ghost" size="sm" href={pageHref(null)}>Newest</Button>
					{:else}
						<span></span>
					{/if}
					{#if data.activity.next}
						<Button variant="outline" size="sm" href={pageHref(formatCursor(data.activity.next))}>
							Older events
						</Button>
					{/if}
				</div>
			{/if}
		</Card.Root>
	{/if}
</div>
