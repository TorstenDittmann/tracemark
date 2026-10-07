<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let confirmName = $state('');

const isOwner = $derived(data.role === 'owner');
const messageFor = (action: string) => (form?.action === action ? form.message : null);
</script>

<svelte:head>
	<title>Settings · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Name</Card.Title>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/rename"
				class="flex gap-2"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<Label for="name" class="sr-only">Project name</Label>
				<Input
					id="name"
					name="name"
					required
					maxlength={100}
					value={data.project.name}
					class="max-w-sm"
				/>
				<Button type="submit" variant="outline">Save</Button>
			</form>
			{#if messageFor('rename')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">{messageFor('rename')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Rotate public key</Card.Title>
			<Card.Description>
				Creates a new key. The old one stops working within about a minute, so events from anything
				still using it are rejected.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/rotate"
				use:enhance={({ cancel }) => {
					if (!confirm('Rotate the key? Events sent with the old key will be rejected.')) cancel();
				}}
			>
				<Button type="submit" variant="outline" disabled={!isOwner}>Rotate key</Button>
			</form>
			{#if messageFor('rotate')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">{messageFor('rotate')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-destructive/40">
		<Card.Header>
			<Card.Title>Delete project</Card.Title>
			<Card.Description>
				Deletes the project, its key and all of its events. This cannot be undone.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/delete" class="grid max-w-sm gap-2" use:enhance>
				<Label for="confirm"
					><span>Type <strong>{data.project.name}</strong> to confirm</span></Label
				>
				<Input
					id="confirm"
					name="confirm"
					autocomplete="off"
					bind:value={confirmName}
					disabled={!isOwner}
				/>
				<div>
					<Button
						type="submit"
						variant="destructive"
						disabled={!isOwner || confirmName !== data.project.name}
					>
						Delete project
					</Button>
				</div>
			</form>
			{#if messageFor('delete')}
				<p class="mt-2 text-sm text-destructive" role="alert">{messageFor('delete')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if !isOwner}
		<p class="text-sm text-muted-foreground">
			Only organization owners can rotate keys or delete projects.
		</p>
	{/if}
</div>
