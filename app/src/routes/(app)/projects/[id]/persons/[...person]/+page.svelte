<script lang="ts">
import EventList from '#lib/components/events/event-list.svelte';
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { personName } from '#lib/persons.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const name = $derived(data.person ? personName(data.person.person, data.person.properties) : '');
const properties = $derived(
	Object.entries(data.person?.properties ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
);

function display(value: unknown): string {
	return typeof value === 'string' ? value : JSON.stringify(value);
}
</script>

<svelte:head>
	<title>{name || 'Person'} · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<a
		href="/projects/{data.project.id}/persons"
		class="text-sm text-muted-foreground hover:underline"
	>
		← People
	</a>
	{#if !data.person}
		<p class="text-sm text-muted-foreground">
			This person is unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		{@const person = data.person}
		<div class="grid gap-1">
			<h2 class="text-xl font-semibold break-all">{name}</h2>
			{#if name !== person.person}
				<p class="text-sm break-all text-muted-foreground">{person.person}</p>
			{/if}
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<Card.Root class="min-w-0 gap-2">
				<Card.Header>
					<Card.Description>Events</Card.Description>
					<Card.Title class="text-2xl tabular-nums">{person.events.toLocaleString()}</Card.Title>
				</Card.Header>
			</Card.Root>
			<Card.Root class="min-w-0 gap-2">
				<Card.Header>
					<Card.Description>First seen</Card.Description>
					<Card.Title class="text-lg">
						{person.firstSeen ? dateFormat.format(new Date(person.firstSeen)) : '–'}
					</Card.Title>
				</Card.Header>
			</Card.Root>
			<Card.Root class="min-w-0 gap-2">
				<Card.Header>
					<Card.Description>Last seen</Card.Description>
					<Card.Title class="text-lg">
						{person.lastSeen ? dateFormat.format(new Date(person.lastSeen)) : '–'}
					</Card.Title>
				</Card.Header>
			</Card.Root>
		</div>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
			<div class="grid content-start gap-6">
				<Card.Root class="min-w-0 gap-3">
					<Card.Header>
						<Card.Title>Properties</Card.Title>
					</Card.Header>
					<Card.Content>
						{#if properties.length}
							<table class="w-full text-left text-sm">
								<tbody>
									{#each properties as [key, value] (key)}
										<tr class="border-t first:border-t-0">
											<th
												scope="row"
												class="w-2/5 py-1.5 pr-4 align-top font-normal [overflow-wrap:anywhere]"
											>
												{key}
											</th>
											<td class="py-1.5 font-mono text-xs break-all">{display(value)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<p class="text-sm text-muted-foreground">
								No person properties. Set them with <code>identify</code> or
								<code>setPersonProperties</code>.
							</p>
						{/if}
					</Card.Content>
				</Card.Root>
				{#if data.cohorts.length}
					<Card.Root class="min-w-0 gap-3">
						<Card.Header>
							<Card.Title>Add to a cohort</Card.Title>
						</Card.Header>
						<Card.Content class="grid gap-2">
							<form method="POST" action="?/addToCohort" use:enhance class="flex flex-wrap gap-2">
								<select name="cohort" class={selectClass} aria-label="Static cohort">
									{#each data.cohorts as cohort (cohort.id)}
										<option value={cohort.id}>{cohort.name}</option>
									{/each}
								</select>
								<Button type="submit" size="sm" variant="outline">Add</Button>
							</form>
							{#if form?.message}
								<p class="text-sm text-muted-foreground" role="status">{form.message}</p>
							{/if}
						</Card.Content>
					</Card.Root>
				{/if}
				<Card.Root class="min-w-0 gap-3">
					<Card.Header>
						<Card.Title>Distinct ids</Card.Title>
						<Card.Description>Every id this person's events were sent with.</Card.Description>
					</Card.Header>
					<Card.Content>
						<ul class="grid gap-1 font-mono text-xs">
							{#each person.distinctIds as id (id)}
								<li class="break-all">{id}</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			</div>
			<section class="grid min-w-0 content-start gap-3">
				<h3 class="font-semibold">Timeline</h3>
				{#if data.timeline}
					<EventList
						activity={data.timeline}
						paged={data.paged}
						projectId={data.project.id}
						showPerson={false}
					/>
				{:else}
					<p class="text-sm text-muted-foreground">
						The timeline is unavailable because ClickHouse could not be reached.
					</p>
				{/if}
			</section>
		</div>
	{/if}
</div>
