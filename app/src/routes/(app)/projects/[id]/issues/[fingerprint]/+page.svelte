<script lang="ts">
import LineChart from '#lib/components/charts/line-chart.svelte';
import IssueStatus from '#lib/components/issues/issue-status.svelte';
import StackTrace from '#lib/components/issues/stack-trace.svelte';
import RangePicker from '#lib/components/range-picker.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { issuesHref } from '#lib/issues.js';
import { personHref } from '#lib/persons.js';
import { RANGES } from '#lib/web.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const issue = $derived(data.issue);
const rangeLabel = $derived(RANGES[data.range].label.toLowerCase());

const actions = $derived(
	data.status === 'open'
		? [
				{ status: 'resolved', label: 'Resolve', variant: 'default' as const },
				{ status: 'ignored', label: 'Ignore', variant: 'outline' as const }
			]
		: [{ status: 'open', label: 'Reopen', variant: 'outline' as const }]
);
</script>

<svelte:head>
	<title>{issue?.type ?? 'Issue'} · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="grid min-w-0 gap-0.5">
			<a href={issuesHref(data.project.id)} class="text-sm text-muted-foreground hover:underline">
				Issues
			</a>
			<h2 class="truncate text-xl font-semibold">{issue?.type ?? 'Issue'}</h2>
			{#if issue}
				<p class="break-words text-muted-foreground">{issue.value || 'No message'}</p>
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					<IssueStatus status={data.status} regressed={data.regressed} />
					<span class="text-muted-foreground">
						First seen {dateFormat.format(new Date(issue.firstSeen))}
					</span>
					{#if issue.release}
						<span class="text-muted-foreground">Latest release {issue.release}</span>
					{/if}
				</div>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if issue}
				{#each actions as action (action.status)}
					<form method="POST" action="?/status" use:enhance>
						<input type="hidden" name="status" value={action.status}>
						<Button type="submit" size="sm" variant={action.variant}>{action.label}</Button>
					</form>
				{/each}
			{/if}
			<RangePicker current={data.range} />
		</div>
	</div>
	{#if form?.message}
		<p class="text-sm text-destructive" role="alert">{form.message}</p>
	{/if}

	{#if !issue}
		<p class="text-sm text-muted-foreground">
			This issue is unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each [
				{ label: `Occurrences, ${rangeLabel}`, value: issue.occurrences },
				{ label: `People, ${rangeLabel}`, value: issue.people },
				{ label: 'Occurrences, all time', value: issue.totalOccurrences },
				{ label: 'People, all time', value: issue.totalPeople }
			] as tile (tile.label)}
				<Card.Root class="gap-1 px-4 py-3">
					<dt class="text-xs text-muted-foreground">{tile.label}</dt>
					<dd class="text-2xl font-semibold tabular-nums">{tile.value.toLocaleString()}</dd>
				</Card.Root>
			{/each}
		</dl>

		<Card.Root class="min-w-0 gap-2">
			<Card.Header>
				<Card.Title>Occurrences</Card.Title>
			</Card.Header>
			<Card.Content>
				<LineChart
					lines={[{ key: 'occurrences', label: 'Occurrences', data: issue.series }]}
					buckets={issue.buckets}
					bucket={issue.bucket}
					height={180}
				/>
			</Card.Content>
		</Card.Root>

		<div class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
			<Card.Root class="min-w-0 gap-3">
				<Card.Header>
					<Card.Title>Stack trace</Card.Title>
					<Card.Description>From the latest occurrence.</Card.Description>
				</Card.Header>
				<Card.Content>
					<StackTrace exceptions={issue.exceptions} />
				</Card.Content>
			</Card.Root>

			<Card.Root class="min-w-0 gap-3">
				<Card.Header>
					<Card.Title>Most affected people</Card.Title>
					<Card.Description>In the {rangeLabel}.</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if issue.topPeople.length}
						<ul class="grid gap-1.5 text-sm">
							{#each issue.topPeople as person (person.person)}
								<li class="flex justify-between gap-3">
									<a
										class="truncate hover:underline"
										href={personHref(data.project.id, person.person)}
										>{person.person}</a
									>
									<span class="tabular-nums text-muted-foreground">
										{person.occurrences.toLocaleString()}
									</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-sm text-muted-foreground">
							Nobody in the {rangeLabel}; server errors without a person don't count.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root class="min-w-0 gap-0 py-0">
			<Card.Header class="py-4">
				<Card.Title>Recent occurrences</Card.Title>
			</Card.Header>
			<div class="relative overflow-x-auto">
				<table class="data-table w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Time</th>
							<th class="px-4 py-2 font-normal">Person</th>
							<th class="px-4 py-2 font-normal">Message</th>
							<th class="px-4 py-2 font-normal">Page</th>
							<th class="px-6 py-2 font-normal">Release</th>
						</tr>
					</thead>
					<tbody>
						{#each issue.recent as occurrence (occurrence.uuid)}
							<tr class="border-t">
								<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
									{dateFormat.format(new Date(occurrence.timestamp))}
								</td>
								<td class="max-w-48 px-4 py-2">
									{#if occurrence.person === '$server'}
										<span class="text-muted-foreground">Server</span>
									{:else}
										<a
											class="block truncate hover:underline"
											href={personHref(data.project.id, occurrence.person)}
											>{occurrence.person}</a
										>
									{/if}
								</td>
								<td class="max-w-72 truncate px-4 py-2" title={occurrence.value}>
									{occurrence.value}
								</td>
								<td
									class="max-w-72 truncate px-4 py-2 text-muted-foreground"
									title={occurrence.url}
								>
									{occurrence.url}
								</td>
								<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
									{occurrence.release}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card.Root>
	{/if}
</div>
