<script lang="ts">
import * as Card from '#lib/components/ui/card/index.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Team · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<h1 class="text-2xl font-semibold tracking-tight">Organizations</h1>
	<div class="grid gap-3 sm:grid-cols-2">
		{#each data.organizations as organization (organization.id)}
			<a href="/organizations/{organization.id}" class="block">
				<Card.Root class="gap-1 py-4 transition-colors hover:bg-accent/50">
					<Card.Header class="px-4">
						<Card.Title>{organization.name}</Card.Title>
						<Card.Description class="capitalize">{organization.role}</Card.Description>
					</Card.Header>
				</Card.Root>
			</a>
		{/each}
	</div>
</div>
