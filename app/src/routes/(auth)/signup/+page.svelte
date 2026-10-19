<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { Spinner } from '#lib/components/ui/spinner/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let pending = $state(false);
</script>

<svelte:head>
	<title>Sign up · Tracemark</title>
</svelte:head>

<div class="grid gap-8">
	<div class="grid gap-1">
		<h1 class="text-2xl font-semibold tracking-tight">Create your account</h1>
		<p class="text-sm text-muted-foreground">
			You get your own workspace and can invite teammates to it.
		</p>
	</div>
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
		<div class="grid gap-2">
			<Label for="name">Your name</Label>
			<Input
				id="name"
				name="name"
				autocomplete="name"
				placeholder="Ada Lovelace"
				required
				value={form?.values?.name ?? ''}
				aria-invalid={form?.errors?.name ? true : undefined}
			/>
			{#if form?.errors?.name}
				<p class="text-sm text-destructive">{form.errors.name}</p>
			{/if}
		</div>
		<div class="grid gap-2">
			<Label for="email">Email</Label>
			<Input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				placeholder="ada@example.com"
				required
				value={form?.values?.email ?? ''}
				aria-invalid={form?.errors?.email ? true : undefined}
			/>
			{#if form?.errors?.email}
				<p class="text-sm text-destructive">{form.errors.email}</p>
			{/if}
		</div>
		<div class="grid gap-2">
			<Label for="password">Password</Label>
			<Input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength={data.minPasswordLength}
				required
				aria-invalid={form?.errors?.password ? true : undefined}
				aria-describedby="password-hint"
			/>
			<p id="password-hint" class="text-xs text-muted-foreground">
				{#if form?.errors?.password}
					<span class="text-destructive">{form.errors.password}</span>
				{:else}
					At least {data.minPasswordLength} characters.
				{/if}
			</p>
		</div>
		<div class="grid gap-2">
			<Label for="organization">Workspace name</Label>
			<Input
				id="organization"
				name="organization"
				autocomplete="organization"
				placeholder="Acme Inc."
				required
				value={form?.values?.organization ?? ''}
				aria-invalid={form?.errors?.organization ? true : undefined}
			/>
			{#if form?.errors?.organization}
				<p class="text-sm text-destructive">{form.errors.organization}</p>
			{/if}
		</div>
		<Button type="submit" class="mt-2" disabled={pending}>
			{#if pending}
				<Spinner />
			{/if}
			Create account
		</Button>
	</form>
	<p class="text-center text-sm text-muted-foreground">
		Already have an account?
		<a href="/login" class="font-medium text-foreground underline-offset-4 hover:underline"
			>Sign in</a
		>
	</p>
</div>
