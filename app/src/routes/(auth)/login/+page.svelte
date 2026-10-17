<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { Spinner } from '#lib/components/ui/spinner/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { form }: PageProps = $props();
let pending = $state(false);
</script>

<svelte:head>
	<title>Sign in · Tracemark</title>
</svelte:head>

<div class="grid gap-8">
	<div class="grid gap-1">
		<h1 class="text-2xl font-semibold tracking-tight">Welcome back</h1>
		<p class="text-sm text-muted-foreground">
			Sign in with the email and password for this instance.
		</p>
	</div>
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
				placeholder="you@example.com"
				required
				value={form?.email ?? ''}
				aria-invalid={form?.message ? true : undefined}
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
				aria-invalid={form?.message ? true : undefined}
			/>
		</div>
		{#if form?.message}
			<p
				class="animate-enter rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{form.message}
			</p>
		{/if}
		<Button type="submit" class="mt-2" disabled={pending}>
			{#if pending}
				<Spinner />
			{/if}
			Sign in
		</Button>
	</form>
	<p class="text-center text-sm text-muted-foreground">
		Forgot your password? Run
		<code class="rounded bg-muted px-1.5 py-0.5 text-xs">bun run reset-password</code>
		on the server.
	</p>
</div>
