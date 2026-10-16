<script lang="ts">
import PeopleNav from '#lib/components/people/people-nav.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { LOOKBACK_DAYS } from '#lib/explore.js';
import { formatPersonCursor, personHref, personName } from '#lib/persons.js';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function pageHref(before: string | null): string {
	const url = new URL(page.url.href);
	if (before) url.searchParams.set('before', before);
	else url.searchParams.delete('before');
	return `${url.pathname}${url.search}`;
}
</script>

<svelte:head>
	<title>People · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<PeopleNav projectId={data.project.id} />
	{#if page.url.searchParams.has('deleted')}
		<p class="text-sm text-muted-foreground" role="status">
			Deleted the person and their events. They may still show up here for a few seconds.
		</p>
	{/if}
	<search>
		<form method="GET" class="flex max-w-md gap-2">
			<Input
				name="search"
				type="search"
				value={data.search}
				placeholder="Search by id, email or any property"
				aria-label="Search people"
			/>
			<Button type="submit" variant="outline">Search</Button>
		</form>
	</search>

	{#if !data.people}
		<p class="text-sm text-muted-foreground">
			People are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<Card.Root class="min-w-0 gap-0 py-0">
			{#if data.people.persons.length}
				<div class="relative overflow-x-auto">
					<table class="w-full text-sm">
						<caption class="sr-only">
							People seen in the last {LOOKBACK_DAYS} days
						</caption>
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">Person</th>
								<th class="px-4 py-2 text-right font-normal">Events, last {LOOKBACK_DAYS} days</th>
								<th class="px-4 py-2 font-normal">First seen</th>
								<th class="px-6 py-2 font-normal">Last seen</th>
							</tr>
						</thead>
						<tbody>
							{#each data.people.persons as person (person.person)}
								{@const name = personName(person.person, person.properties)}
								<tr class="border-t">
									<td class="max-w-80 px-6 py-2">
										<a
											class="block truncate font-medium hover:underline"
											href={personHref(data.project.id, person.person)}
										>
											{name}
										</a>
										{#if name !== person.person}
											<span class="block truncate text-xs text-muted-foreground"
												>{person.person}</span
											>
										{/if}
									</td>
									<td class="px-4 py-2 text-right tabular-nums">
										{person.events.toLocaleString()}
									</td>
									<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
										{dateFormat.format(new Date(person.firstSeen))}
									</td>
									<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
										{dateFormat.format(new Date(person.lastSeen))}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="px-6 py-10 text-center text-sm text-muted-foreground">
					{#if data.paged}
						No more people.
					{:else if data.search}
						Nobody matches “{data.search}”.
					{:else}
						Nobody in the last {LOOKBACK_DAYS} days yet.
					{/if}
				</p>
			{/if}
			{#if data.paged || data.people.next}
				<div class="flex justify-between gap-2 border-t px-6 py-3">
					{#if data.paged}
						<Button variant="ghost" size="sm" href={pageHref(null)}>Most recent</Button>
					{:else}
						<span></span>
					{/if}
					{#if data.people.next}
						<Button
							variant="outline"
							size="sm"
							href={pageHref(formatPersonCursor(data.people.next))}
						>
							More people
						</Button>
					{/if}
				</div>
			{/if}
		</Card.Root>
	{/if}
</div>
