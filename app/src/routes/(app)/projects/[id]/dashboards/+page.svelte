<script lang="ts">
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import EmptyState from '#lib/components/empty-state.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Dashboards · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<form method="POST" action="?/create" use:enhance class="flex flex-wrap items-center gap-2">
		<Input
			name="name"
			aria-label="Dashboard name"
			placeholder="New dashboard name"
			value={form?.name ?? ''}
			maxlength={100}
			required
			class="h-8 w-64"
		/>
		<Button type="submit" size="sm">Create dashboard</Button>
		{#if form?.message}
			<p class="text-sm text-destructive" role="alert">{form.message}</p>
		{/if}
	</form>

	{#if data.dashboards.length}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.dashboards as dashboard (dashboard.id)}
				<a
					href="/projects/{data.project.id}/dashboards/{dashboard.id}"
					class="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
				>
					<span
						class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
					>
						<LayoutGrid class="size-5" />
					</span>
					<span class="min-w-0 flex-1 truncate font-medium">{dashboard.name}</span>
					<ArrowRight
						class="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
					/>
				</a>
			{/each}
		</div>
	{:else}
		<Card.Root class="py-0">
			<EmptyState
				icon={LayoutGrid}
				title="No dashboards yet"
				description="Dashboards collect saved insights on one page. Create one above, then add insights to it from Insights."
			/>
		</Card.Root>
	{/if}
</div>
