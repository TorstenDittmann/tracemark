<script lang="ts">
import EventList from '#lib/components/events/event-list.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { groupName, groupsHref } from '#lib/groups.js';
import { personHref, personName } from '#lib/persons.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const name = $derived(data.group ? groupName(data.group.key, data.group.properties) : '');
const properties = $derived(
	Object.entries(data.group?.properties ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
);

function display(value: unknown): string {
	return typeof value === 'string' ? value : JSON.stringify(value);
}
</script>

<svelte:head>
	<title>{name || 'Group'} · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	{#if !data.group}
		<a href={groupsHref(data.project.id)} class="text-sm text-muted-foreground hover:underline">
			← Groups
		</a>
		<p class="text-sm text-muted-foreground">
			This group is unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		{@const group = data.group}
		<a
			href={groupsHref(data.project.id, group.type)}
			class="text-sm text-muted-foreground hover:underline"
		>
			← {group.type}
		</a>
		<div class="grid gap-1">
			<h2 class="text-xl font-semibold break-all">{name}</h2>
			<p class="text-sm break-all text-muted-foreground">
				{group.type}{name !== group.key ? ` · ${group.key}` : ''}
			</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<Card.Root class="min-w-0 gap-2">
				<Card.Header>
					<Card.Description>People</Card.Description>
					<Card.Title class="text-2xl tabular-nums">{group.people.toLocaleString()}</Card.Title>
				</Card.Header>
			</Card.Root>
			<Card.Root class="min-w-0 gap-2">
				<Card.Header>
					<Card.Description>Events</Card.Description>
					<Card.Title class="text-2xl tabular-nums">{group.events.toLocaleString()}</Card.Title>
				</Card.Header>
			</Card.Root>
			<Card.Root class="min-w-0 gap-2">
				<Card.Header>
					<Card.Description>Last seen</Card.Description>
					<Card.Title class="text-lg">
						{group.lastSeen ? dateFormat.format(new Date(group.lastSeen)) : '–'}
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
								No group properties. Pass them as the third argument to <code>group</code>.
							</p>
						{/if}
					</Card.Content>
				</Card.Root>
				<Card.Root class="min-w-0 gap-3">
					<Card.Header>
						<Card.Title>People</Card.Title>
						<Card.Description>The most active people in this group.</Card.Description>
					</Card.Header>
					<Card.Content>
						<table class="w-full text-left text-sm">
							<thead class="text-xs text-muted-foreground">
								<tr>
									<th class="pb-1 font-normal">Person</th>
									<th class="pb-1 text-right font-normal">Events</th>
								</tr>
							</thead>
							<tbody>
								{#each group.members as member (member.person)}
									<tr class="border-t">
										<td class="max-w-0 py-1.5 pr-4">
											<a
												class="block truncate hover:underline"
												href={personHref(data.project.id, member.person)}
											>
												{personName(member.person, member.properties)}
											</a>
										</td>
										<td class="py-1.5 text-right tabular-nums">{member.events.toLocaleString()}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</Card.Content>
				</Card.Root>
			</div>
			<section class="grid min-w-0 content-start gap-3">
				<h3 class="font-semibold">Timeline</h3>
				{#if data.timeline}
					<EventList activity={data.timeline} paged={data.paged} projectId={data.project.id} />
				{:else}
					<p class="text-sm text-muted-foreground">
						The timeline is unavailable because ClickHouse could not be reached.
					</p>
				{/if}
			</section>
		</div>
	{/if}
</div>
