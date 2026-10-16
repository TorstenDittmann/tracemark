<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let pending = $state(false);

const invitation = $derived(data.invitation);
const isRecipient = $derived(data.signedInAs === invitation.email);
const loginHref = $derived(`/login?next=${encodeURIComponent(page.url.pathname)}`);

const submit = () => {
	pending = true;
	return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
		pending = false;
	};
};
</script>

<svelte:head>
	<title>Join {invitation.organizationName} · footprint</title>
</svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>Join {invitation.organizationName}</Card.Title>
		<Card.Description>
			{invitation.inviterName}
			invited <strong>{invitation.email}</strong> as
			{invitation.role === 'admin' ? 'an admin' : 'a member'}.
		</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4">
		{#if isRecipient}
			<form method="POST" action="?/accept" use:enhance={submit}>
				<Button type="submit" class="w-full" disabled={pending}>Accept invitation</Button>
			</form>
		{:else if data.signedInAs}
			<p class="text-sm text-muted-foreground">
				You're signed in as {data.signedInAs}. Sign out, then open this link again to accept as
				{invitation.email}.
			</p>
			<form method="POST" action="/logout">
				<Button type="submit" variant="outline" class="w-full">Sign out</Button>
			</form>
		{:else if data.hasAccount}
			<p class="text-sm text-muted-foreground">Sign in as {invitation.email} to accept.</p>
			<Button href={loginHref} class="w-full">Sign in</Button>
		{:else}
			<form method="POST" action="?/join" class="grid gap-4" use:enhance={submit}>
				<div class="grid gap-2">
					<Label for="name">Your name</Label>
					<Input id="name" name="name" autocomplete="name" required value={form?.name ?? ''} />
				</div>
				<div class="grid gap-2">
					<Label for="password">Choose a password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="new-password"
						required
					/>
				</div>
				<Button type="submit" disabled={pending}>Create account and join</Button>
			</form>
		{/if}
		{#if form?.message}
			<p class="text-sm text-destructive" role="alert">{form.message}</p>
		{/if}
	</Card.Content>
</Card.Root>
