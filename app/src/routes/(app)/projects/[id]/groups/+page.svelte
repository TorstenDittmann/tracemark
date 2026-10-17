<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { LOOKBACK_DAYS } from '#lib/explore.js';
import { formatGroupCursor, groupHref, groupName, groupsHref } from '#lib/groups.js';
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

const example = `footprint.group('company', 'acme', { name: 'Acme Inc' });`;
</script>

<svelte:head>
	<title>Groups · {data.project.name} · footprint</title>
</svelte:head>

{#if !data.types}
	<p class="text-sm text-muted-foreground">
		Groups are unavailable because ClickHouse could not be reached.
	</p>
{:else if !data.type}
	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>No groups yet</Card.Title>
			<Card.Description>
				Groups collect events by company, team or any other unit above a person. Put a person in a
				group and every event they send after that carries it:
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<pre class="overflow-x-auto rounded-md border bg-muted p-4 font-mono text-sm">{example}</pre>
		</Card.Content>
	</Card.Root>
{:else}
	<div class="grid gap-4">
		<nav class="flex gap-1 overflow-x-auto text-sm" aria-label="Group types">
			{#each data.types as type (type.type)}
				{@const active = type.type === data.type}
				<a
					href={groupsHref(data.project.id, type.type)}
					class={[
						'rounded-md px-3 py-1.5 whitespace-nowrap',
						active ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground'
					]}
					aria-current={active ? 'page' : undefined}
				>
					{type.type}
					<span class="text-muted-foreground tabular-nums">{type.groups.toLocaleString()}</span>
				</a>
			{/each}
		</nav>

		<search>
			<form method="GET" class="flex max-w-md gap-2">
				<input type="hidden" name="type" value={data.type}>
				<Input
					name="search"
					type="search"
					value={data.search}
					placeholder="Search by key, name or any property"
					aria-label="Search groups"
				/>
				<Button type="submit" variant="outline">Search</Button>
			</form>
		</search>

		{#if data.groups}
			<Card.Root class="min-w-0 gap-0 py-0">
				{#if data.groups.groups.length}
					<div class="relative overflow-x-auto">
						<table class="data-table w-full text-sm">
							<caption class="sr-only">
								{data.type}
								groups seen in the last {LOOKBACK_DAYS} days
							</caption>
							<thead class="text-left text-xs text-muted-foreground">
								<tr>
									<th class="px-6 py-2 font-normal">Group</th>
									<th class="px-4 py-2 text-right font-normal">People</th>
									<th class="px-4 py-2 text-right font-normal">
										Events, last {LOOKBACK_DAYS} days
									</th>
									<th class="px-6 py-2 font-normal">Last seen</th>
								</tr>
							</thead>
							<tbody>
								{#each data.groups.groups as group (group.key)}
									{@const name = groupName(group.key, group.properties)}
									<tr class="border-t">
										<td class="max-w-80 px-6 py-2">
											<a
												class="block truncate font-medium hover:underline"
												href={groupHref(data.project.id, data.type, group.key)}
											>
												{name}
											</a>
											{#if name !== group.key}
												<span class="block truncate text-xs text-muted-foreground"
													>{group.key}</span
												>
											{/if}
										</td>
										<td class="px-4 py-2 text-right tabular-nums">
											{group.people.toLocaleString()}
										</td>
										<td class="px-4 py-2 text-right tabular-nums">
											{group.events.toLocaleString()}
										</td>
										<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
											{dateFormat.format(new Date(group.lastSeen))}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="px-6 py-10 text-center text-sm text-muted-foreground">
						{#if data.paged}
							No more groups.
						{:else if data.search}
							No {data.type} matches “{data.search}”.
						{:else}
							No {data.type} groups in the last {LOOKBACK_DAYS} days.
						{/if}
					</p>
				{/if}
				{#if data.paged || data.groups.next}
					<div class="flex justify-between gap-2 border-t px-6 py-3">
						{#if data.paged}
							<Button variant="ghost" size="sm" href={pageHref(null)}>Most recent</Button>
						{:else}
							<span></span>
						{/if}
						{#if data.groups.next}
							<Button
								variant="outline"
								size="sm"
								href={pageHref(formatGroupCursor(data.groups.next))}
							>
								More groups
							</Button>
						{/if}
					</div>
				{/if}
			</Card.Root>
		{/if}
	</div>
{/if}
