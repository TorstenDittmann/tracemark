<script lang="ts">
import Bookmark from '@lucide/svelte/icons/bookmark';
import EmptyState from '#lib/components/empty-state.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { INSIGHT_KINDS, insightHref } from '#lib/insight-kinds.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head>
	<title>Saved insights · {data.project.name} · Tracemark</title>
</svelte:head>

<Card.Root class="min-w-0 py-2">
	{#if data.insights.length}
		<div class="relative overflow-x-auto">
			<table class="data-table w-full text-sm">
				<thead class="text-left text-xs text-muted-foreground">
					<tr>
						<th class="px-6 py-2 font-normal">Name</th>
						<th class="px-4 py-2 font-normal">Type</th>
						<th class="px-4 py-2 font-normal">Updated</th>
						<th class="px-6 py-2"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.insights as insight (insight.id)}
						<tr class="border-t">
							<td class="px-6 py-2">
								<a href={insightHref(data.project.id, insight)} class="font-medium hover:underline">
									{insight.name}
								</a>
							</td>
							<td class="px-4 py-2 text-muted-foreground">{INSIGHT_KINDS[insight.kind].label}</td>
							<td class="px-4 py-2 text-muted-foreground">
								{dateFormat.format(insight.updatedAt)}
							</td>
							<td class="px-6 py-2 text-right">
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="insight" value={insight.id}>
									<Button
										type="submit"
										variant="ghost"
										size="sm"
										onclick={(e) => {
											if (!confirm(`Delete “${insight.name}”? It is removed from every dashboard.`))
												e.preventDefault();
										}}
									>
										Delete
									</Button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<EmptyState
			icon={Bookmark}
			title="No saved insights yet"
			description="Build a trend, funnel, retention, paths, lifecycle or stickiness view and save it to find it here."
		>
			<Button href="/projects/{data.project.id}/insights/trends" size="sm">New trend</Button>
		</EmptyState>
	{/if}
</Card.Root>
