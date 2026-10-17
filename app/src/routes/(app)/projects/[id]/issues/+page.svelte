<script lang="ts">
import IssueStatus from '#lib/components/issues/issue-status.svelte';
import Sparkline from '#lib/components/issues/sparkline.svelte';
import RangePicker from '#lib/components/range-picker.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { issueHref, STATUSES, type IssueStatus as Status } from '#lib/issues.js';
import { RANGES } from '#lib/web.js';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const statuses = Object.keys(STATUSES) as Status[];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ago(iso: string): string {
	const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
	if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
	return relative.format(Math.round(hours / 24), 'day');
}

function statusHref(status: Status): string {
	const url = new URL(page.url.href);
	if (status === 'open') url.searchParams.delete('status');
	else url.searchParams.set('status', status);
	return `${url.pathname}${url.search}`;
}

const rangeLabel = $derived(RANGES[data.range].label.toLowerCase());
</script>

<svelte:head>
	<title>Issues · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<nav class="flex gap-1 text-sm" aria-label="Issue status">
			{#each statuses as status (status)}
				<a
					href={statusHref(status)}
					aria-current={data.status === status ? 'page' : undefined}
					class={[
						'rounded-md px-2.5 py-1',
						data.status === status
							? 'bg-background text-foreground shadow-sm dark:bg-input/40'
							: 'text-muted-foreground hover:text-foreground'
					]}
				>
					{STATUSES[status]}
					<span class="ml-1 tabular-nums text-muted-foreground">{data.counts[status]}</span>
				</a>
			{/each}
		</nav>
		<RangePicker current={data.range} />
	</div>

	{#if !data.list}
		<p class="text-sm text-muted-foreground">
			Issues are unavailable because ClickHouse could not be reached.
		</p>
	{:else}
		<Card.Root class="min-w-0 gap-0 py-0">
			{#if data.list.issues.length}
				<div class="relative overflow-x-auto">
					<table class="w-full text-sm">
						<caption class="sr-only">
							{STATUSES[data.status]}
							issues in the {rangeLabel}
						</caption>
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">Issue</th>
								<th class="hidden px-4 py-2 font-normal sm:table-cell">Trend</th>
								<th class="px-4 py-2 text-right font-normal">Occurrences</th>
								<th class="px-4 py-2 text-right font-normal">People</th>
								<th class="px-6 py-2 font-normal">Last seen</th>
							</tr>
						</thead>
						<tbody>
							{#each data.list.issues as issue (issue.fingerprint)}
								<tr class="border-t align-top">
									<td class="max-w-[12rem] px-6 py-3 sm:max-w-[28rem]">
										<a
											class="block truncate font-medium hover:underline"
											href={issueHref(data.project.id, issue.fingerprint)}
										>
											{issue.type}
										</a>
										<span class="block truncate text-muted-foreground" title={issue.value}>
											{issue.value || 'No message'}
										</span>
										<span class="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
											{#if issue.regressed}
												<IssueStatus status={issue.status} regressed />
											{/if}
											<span title={dateFormat.format(new Date(issue.firstSeen))}>
												First seen {ago(issue.firstSeen)}
											</span>
										</span>
									</td>
									<td class="hidden px-4 py-3 sm:table-cell">
										<Sparkline
											data={issue.series}
											buckets={data.list.buckets}
											bucket={data.list.bucket}
										/>
									</td>
									<td class="px-4 py-3 text-right tabular-nums">
										{issue.occurrences.toLocaleString()}
									</td>
									<td class="px-4 py-3 text-right tabular-nums">
										{issue.people.toLocaleString()}
									</td>
									<td
										class="px-6 py-3 whitespace-nowrap text-muted-foreground"
										title={dateFormat.format(new Date(issue.lastSeen))}
									>
										{ago(issue.lastSeen)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div class="grid justify-items-center gap-1 px-6 py-10 text-center text-sm">
					{#if data.status === 'open'}
						<p class="font-medium">No open issues in the {rangeLabel}.</p>
						<p class="text-muted-foreground">
							Errors captured with the browser or Node SDK show up here. See
							<a
								class="underline"
								href="https://github.com/TorstenDittmann/footprint/blob/main/docs/errors.md"
								>docs/errors.md</a
							>.
						</p>
					{:else}
						<p class="text-muted-foreground">
							No {STATUSES[data.status].toLowerCase()} issues in the {rangeLabel}.
						</p>
					{/if}
				</div>
			{/if}
		</Card.Root>
	{/if}
</div>
