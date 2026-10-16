<script lang="ts">
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
				<a href="/projects/{data.project.id}/dashboards/{dashboard.id}" class="group">
					<Card.Root class="gap-1 py-5 transition-colors group-hover:bg-accent">
						<Card.Header>
							<Card.Title>{dashboard.name}</Card.Title>
						</Card.Header>
					</Card.Root>
				</a>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">
			Dashboards collect saved insights on one page. Create one, then add insights to it from the
			Insights tab.
		</p>
	{/if}
</div>
