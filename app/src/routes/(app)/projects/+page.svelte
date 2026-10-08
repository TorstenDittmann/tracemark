<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let pending = $state(false);
</script>

<svelte:head>
	<title>Projects · footprint</title>
</svelte:head>

<div class="grid gap-8">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
		<p class="text-sm text-muted-foreground">
			Each project has its own key and its own events. Use one per website or app.
		</p>
	</div>

	{#if data.projects.length}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each data.projects as project (project.id)}
				<a href="/projects/{project.id}" class="block">
					<Card.Root class="gap-1 py-4 transition-colors hover:bg-accent/50">
						<Card.Header class="px-4">
							<Card.Title>{project.name}</Card.Title>
							<Card.Description>{project.organizationName}</Card.Description>
						</Card.Header>
					</Card.Root>
				</a>
			{/each}
		</div>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>New project</Card.Title>
			<Card.Description>You get a public key to put in your SDK setup right away.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/create"
				class="flex flex-col gap-4 sm:flex-row sm:items-end"
				use:enhance={() => {
					pending = true;
					return async ({ update }) => {
						await update({ reset: false });
						pending = false;
					};
				}}
			>
				<div class="grid flex-1 gap-2">
					<Label for="name">Name</Label>
					<Input
						id="name"
						name="name"
						placeholder="Website"
						required
						maxlength={100}
						value={form?.name ?? ''}
						aria-invalid={form?.error ? true : undefined}
					/>
				</div>
				{#if data.organizations.length > 1}
					<div class="grid gap-2">
						<Label for="organization">Organization</Label>
						<select
							id="organization"
							name="organization"
							class="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
						>
							{#each data.organizations as organization (organization.id)}
								<option value={organization.id}>{organization.name}</option>
							{/each}
						</select>
					</div>
				{:else if data.organizations[0]}
					<input type="hidden" name="organization" value={data.organizations[0].id}>
				{/if}
				<Button type="submit" disabled={pending}>Create project</Button>
			</form>
			{#if form?.error}
				<p class="mt-2 text-sm text-destructive" role="alert">{form.error}</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
