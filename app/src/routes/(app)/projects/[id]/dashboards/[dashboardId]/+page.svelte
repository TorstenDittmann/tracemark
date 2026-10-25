<script lang="ts">
import FunnelView from '#lib/components/insights/funnel-view.svelte';
import LifecycleView from '#lib/components/insights/lifecycle-view.svelte';
import PathsView from '#lib/components/insights/paths-view.svelte';
import RetentionView from '#lib/components/insights/retention-view.svelte';
import StickinessView from '#lib/components/insights/stickiness-view.svelte';
import TrendsView from '#lib/components/insights/trends-view.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { INSIGHT_KINDS, insightHref } from '#lib/insight-kinds.js';
import { RANGES } from '#lib/web.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let renaming = $state(false);
</script>

<svelte:head>
	<title>{data.dashboard.name} · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
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
					aria-label="Dashboard name"
					value={data.dashboard.name}
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
			<h2 class="text-xl font-semibold">{data.dashboard.name}</h2>
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
						if (!confirm(`Delete the dashboard “${data.dashboard.name}”? Its insights stay saved.`))
							e.preventDefault();
					}}
				>
					Delete
				</Button>
			</form>
		</div>
	</div>
	{#if form?.message}
		<p class="text-sm text-destructive" role="alert">{form.message}</p>
	{/if}

	{#if data.items.length}
		<div class="grid gap-4 lg:grid-cols-2">
			{#each data.items as item, i (item.id)}
				<Card.Root class="min-w-0 gap-4">
					<Card.Header class="flex flex-row items-start justify-between gap-2">
						<div class="grid min-w-0 gap-1">
							<Card.Title class="truncate">
								<a href={insightHref(data.project.id, item)} class="hover:underline">{item.name}</a>
							</Card.Title>
							<Card.Description>
								{INSIGHT_KINDS[item.kind].label}{item.view
									? ` · ${RANGES[item.view.query.range].label}`
									: ''}
							</Card.Description>
						</div>
						<form method="POST" action="?/move" use:enhance class="flex shrink-0 items-center">
							<input type="hidden" name="insight" value={item.id}>
							<Button
								type="submit"
								name="direction"
								value="up"
								size="sm"
								variant="ghost"
								disabled={i === 0}
								aria-label="Move {item.name} up"
							>
								↑
							</Button>
							<Button
								type="submit"
								name="direction"
								value="down"
								size="sm"
								variant="ghost"
								disabled={i === data.items.length - 1}
								aria-label="Move {item.name} down"
							>
								↓
							</Button>
							<Button
								type="submit"
								formaction="?/remove"
								size="sm"
								variant="ghost"
								aria-label="Remove {item.name} from this dashboard"
							>
								Remove
							</Button>
						</form>
					</Card.Header>
					<Card.Content class="min-w-0">
						{#if !item.view}
							<p class="text-sm text-muted-foreground">
								Unavailable because ClickHouse could not be reached.
							</p>
						{:else if item.view.kind === 'trends'}
							<TrendsView result={item.view.result} totalLabel="Total" compact />
						{:else if item.view.kind === 'funnel'}
							<FunnelView result={item.view.result} compact />
						{:else if item.view.kind === 'paths'}
							<PathsView
								result={item.view.result}
								countBack={!item.view.query.start && !!item.view.query.end}
								compact
							/>
						{:else if item.view.kind === 'lifecycle'}
							<LifecycleView result={item.view.result} event={item.view.query.event} compact />
						{:else if item.view.kind === 'stickiness'}
							<StickinessView result={item.view.result} compact />
						{:else}
							<RetentionView result={item.view.result} start={item.view.query.start} />
						{/if}
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			This dashboard is empty. Open an insight, save it, then use “Add to dashboard”.
		</p>
	{/if}
</div>
