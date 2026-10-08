<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { form }: PageProps = $props();
let pending = $state(false);

const fields = [
	{ name: 'name', label: 'Your name', type: 'text', autocomplete: 'name' },
	{ name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
	{ name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password' },
	{ name: 'organization', label: 'Organization', type: 'text', autocomplete: 'organization' }
] as const;
</script>

<svelte:head>
	<title>Set up · footprint</title>
</svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>Set up footprint</Card.Title>
		<Card.Description>Create the owner account for this instance.</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			method="POST"
			class="grid gap-4"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update({ reset: false });
					pending = false;
				};
			}}
		>
			{#each fields as field (field.name)}
				{@const error = form?.errors?.[field.name]}
				<div class="grid gap-2">
					<Label for={field.name}>{field.label}</Label>
					<Input
						id={field.name}
						name={field.name}
						type={field.type}
						autocomplete={field.autocomplete}
						required
						value={field.name === 'password' ? '' : (form?.values?.[field.name] ?? '')}
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? `${field.name}-error` : undefined}
					/>
					{#if error}
						<p id="{field.name}-error" class="text-sm text-destructive">{error}</p>
					{/if}
				</div>
			{/each}
			<Button type="submit" disabled={pending}>Create account</Button>
		</form>
	</Card.Content>
</Card.Root>
