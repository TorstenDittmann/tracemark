<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { type ActivityPage, formatCursor } from '#lib/explore.js';
import { personHref } from '#lib/persons.js';
import { page } from '$app/state';

let {
	activity,
	paged,
	projectId,
	showPerson = true
}: {
	activity: ActivityPage;
	/** Whether this is an older page, so a link back to the newest is shown. */
	paged: boolean;
	projectId: string;
	showPerson?: boolean;
} = $props();

const timeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'medium'
});

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

const columns = $derived(
	showPerson
		? 'sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)]'
		: 'sm:grid-cols-[minmax(0,3fr)_minmax(0,1.5fr)]'
);
</script>

<Card.Root class="min-w-0 gap-0 py-0">
	{#if activity.events.length}
		<div
			class="hidden gap-4 px-6 py-2 text-xs text-muted-foreground sm:grid {columns}"
			aria-hidden="true"
		>
			<span>Event</span>
			{#if showPerson}
				<span>Person</span>
			{/if}
			<span class="text-right">Time</span>
		</div>
		<ul>
			{#each activity.events as event (event.uuid)}
				{@const path = where(event.properties)}
				{@const entries = Object.entries(event.properties).sort(([a], [b]) =>
					a < b ? -1 : a > b ? 1 : 0
				)}
				<li class="border-t">
					<details>
						<summary
							class="grid cursor-pointer list-none gap-x-4 gap-y-0.5 px-6 py-2.5 text-sm hover:bg-muted/50 [&::-webkit-details-marker]:hidden {columns}"
						>
							<span class="min-w-0">
								<span class="block truncate font-medium">{event.event}</span>
								{#if path}
									<span class="block truncate text-xs text-muted-foreground">{path}</span>
								{/if}
							</span>
							{#if showPerson}
								<a
									class="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
									href={personHref(projectId, event.person)}
									title={event.person}
								>
									{event.person}
								</a>
							{/if}
							<time
								class="text-muted-foreground tabular-nums sm:text-right sm:whitespace-nowrap"
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
												<th
													scope="row"
													class="w-1/3 py-1 pr-4 align-top font-normal [overflow-wrap:anywhere]"
												>
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
			{paged ? 'No older events.' : 'No events match.'}
		</p>
	{/if}
	{#if paged || activity.next}
		<div class="flex justify-between gap-2 border-t px-6 py-3">
			{#if paged}
				<Button variant="ghost" size="sm" href={pageHref(null)}>Newest</Button>
			{:else}
				<span></span>
			{/if}
			{#if activity.next}
				<Button variant="outline" size="sm" href={pageHref(formatCursor(activity.next))}>
					Older events
				</Button>
			{/if}
		</div>
	{/if}
</Card.Root>
