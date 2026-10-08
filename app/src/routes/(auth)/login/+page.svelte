<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { form }: PageProps = $props();
let pending = $state(false);
</script>

<svelte:head>
	<title>Sign in · footprint</title>
</svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>Sign in</Card.Title>
		<Card.Description>Use the email and password you set up for this instance.</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			method="POST"
			class="grid gap-4"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update();
					pending = false;
				};
			}}
		>
			<div class="grid gap-2">
				<Label for="email">Email</Label>
				<Input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={form?.email ?? ''}
				/>
			</div>
			<div class="grid gap-2">
				<Label for="password">Password</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			{#if form?.message}
				<p class="text-sm text-destructive" role="alert">{form.message}</p>
			{/if}
			<Button type="submit" disabled={pending}>Sign in</Button>
		</form>
	</Card.Content>
</Card.Root>
<p class="mt-4 text-center text-sm text-muted-foreground">
	Forgot your password? Run <code class="rounded bg-muted px-1">bun run reset-password</code> on the
	server.
</p>
