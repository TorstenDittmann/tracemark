<script lang="ts">
import { COHORT_KINDS, MAX_COHORT_ADD } from '#lib/cohorts.js';
import FiltersEditor from '#lib/components/insights/filters-editor.svelte';
import PeopleNav from '#lib/components/people/people-nav.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { LOOKBACK_DAYS } from '#lib/explore.js';
import type { PropertyFilter } from '#lib/insights.js';
import { formatPersonCursor, personHref, personName } from '#lib/persons.js';
import { enhance } from '$app/forms';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let renaming = $state(false);
/** Edited filters, reset whenever the page loads new ones. */
let filters: PropertyFilter[] = $derived(data.filters);
const changed = $derived(JSON.stringify(filters) !== JSON.stringify(data.filters));

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const maxAdd = MAX_COHORT_ADD.toLocaleString();

function pageHref(before: string | null): string {
	const url = new URL(page.url.href);
	if (before) url.searchParams.set('before', before);
	else url.searchParams.delete('before');
	return `${url.pathname}${url.search}`;
}
</script>

<svelte:head>
	<title>{data.cohort.name} · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-4">
	<PeopleNav projectId={data.project.id} />

	<div class="flex flex-wrap items-center justify-between gap-3">
		{#if renaming}
			<form
				method="POST"
				action="?/rename"
				use:enhance={() =>
					async ({ update }) => {
						await update();
						renaming = false;
					}}
				class="flex items-center gap-2"
			>
				<Input
					name="name"
					aria-label="Cohort name"
					value={data.cohort.name}
					maxlength={100}
					required
					class="h-8 w-64"
				/>
				<Button type="submit" size="sm">Save</Button>
				<Button type="button" size="sm" variant="ghost" onclick={() => (renaming = false)}>
					Cancel
				</Button>
			</form>
		{:else}
			<div class="grid gap-0.5">
				<h2 class="text-xl font-semibold">{data.cohort.name}</h2>
				<p class="text-sm text-muted-foreground">
					{COHORT_KINDS[data.cohort.kind]}
					·
					{data.size === null ? '–' : data.size.toLocaleString()}
					{data.size === 1 ? 'person' : 'people'}
				</p>
			</div>
		{/if}
		<div class="flex items-center gap-1">
			{#if !renaming}
				<Button size="sm" variant="ghost" onclick={() => (renaming = true)}>Rename</Button>
			{/if}
			<form method="POST" action="?/delete" use:enhance>
				<Button
					type="submit"
					size="sm"
					variant="ghost"
					onclick={(e) => {
						if (
							!confirm(
								`Delete the cohort “${data.cohort.name}”? Insights narrowed to it will match nobody.`
							)
						)
							e.preventDefault();
					}}
				>
					Delete
				</Button>
			</form>
		</div>
	</div>
	{#if form?.message}
		<p
			class={[
				'text-sm',
				form.action === 'add' || form.action === 'filters'
					? 'text-muted-foreground'
					: 'text-destructive'
			]}
			role="status"
		>
			{form.message}
		</p>
	{/if}

	{#if data.cohort.kind === 'properties'}
		<Card.Root class="min-w-0 gap-4">
			<Card.Header>
				<Card.Title>Who's in it</Card.Title>
				<Card.Description>
					Everyone whose person properties match every filter. A property they don't have counts as
					empty.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<FiltersEditor
					{filters}
					properties={data.properties}
					onchange={(next) => (filters = next)}
				/>
				<form method="POST" action="?/filters" use:enhance class="flex gap-2">
					<input type="hidden" name="filters" value={JSON.stringify(filters)}>
					<Button type="submit" size="sm" disabled={!changed}>Save filters</Button>
					{#if changed}
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onclick={() => (filters = data.filters)}
						>
							Discard
						</Button>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root class="min-w-0 gap-4">
			<Card.Header>
				<Card.Title>Add people</Card.Title>
				<Card.Description>
					One distinct id per line or separated by commas, {maxAdd} at most. An anonymous id that
					was identified adds its person.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/add" use:enhance class="grid max-w-xl gap-2">
					<textarea
						name="ids"
						rows="4"
						aria-label="Distinct ids"
						class="min-w-0 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs dark:bg-input/30"
						placeholder="user_123&#10;user_456"
					></textarea>
					<div><Button type="submit" size="sm">Add to cohort</Button></div>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<section class="grid min-w-0 gap-3">
		<h3 class="font-semibold">Active in the last {LOOKBACK_DAYS} days</h3>
		{#if !data.people}
			<p class="text-sm text-muted-foreground">
				People are unavailable because ClickHouse could not be reached.
			</p>
		{:else}
			<Card.Root class="min-w-0 gap-0 py-0">
				{#if data.people.persons.length}
					<div class="relative overflow-x-auto">
						<table class="data-table w-full text-sm">
							<thead class="text-left text-xs text-muted-foreground">
								<tr>
									<th class="px-6 py-2 font-normal">Person</th>
									<th class="px-4 py-2 text-right font-normal">Events</th>
									<th class="px-4 py-2 font-normal">Last seen</th>
									{#if data.cohort.kind === 'static'}
										<th class="px-6 py-2"><span class="sr-only">Actions</span></th>
									{/if}
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
											{dateFormat.format(new Date(person.lastSeen))}
										</td>
										{#if data.cohort.kind === 'static'}
											<td class="px-6 py-2 text-right">
												<form method="POST" action="?/remove" use:enhance>
													<input type="hidden" name="person" value={person.person}>
													<Button type="submit" size="sm" variant="ghost">Remove</Button>
												</form>
											</td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="px-6 py-10 text-center text-sm text-muted-foreground">
						{data.paged
							? 'No more people.'
							: `Nobody in this cohort was active in the last ${LOOKBACK_DAYS} days.`}
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
	</section>
</div>
