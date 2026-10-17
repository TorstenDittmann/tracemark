<script lang="ts">
import ArrowLeft from '@lucide/svelte/icons/arrow-left';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import Check from '@lucide/svelte/icons/check';
import { Button } from '#lib/components/ui/button/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { Spinner } from '#lib/components/ui/spinner/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let pending = $state(false);

type Field = 'name' | 'email' | 'password' | 'organization';
const steps: { title: string; description: string; fields: Field[] }[] = [
	{
		title: 'Create your account',
		description: 'You become the owner of this Tracemark instance.',
		fields: ['name', 'email', 'password']
	},
	{
		title: 'Name your workspace',
		description: 'Usually your company or team. You can invite teammates to it later.',
		fields: ['organization']
	}
];

let step = $state(0);
let password = $state('');
let organization = $state('');
let formEl = $state<HTMLFormElement>();

// After a failed submit, go back to the first step with an error.
$effect(() => {
	const errors = form?.errors;
	if (!errors) return;
	const first = steps.findIndex((s) => s.fields.some((f) => errors[f]));
	if (first >= 0) step = first;
});

const strength = $derived.by(() => {
	if (!password) return 0;
	let score = password.length >= data.minPasswordLength ? 2 : 1;
	if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
	if (/\d/.test(password) || /[^\w]/.test(password)) score++;
	return Math.min(score, 4);
});
const strengthLabel = $derived(['', 'Too short', 'Okay', 'Good', 'Strong'][strength]);

/** Validates the visible step with the browser's own messages before moving on. */
function next() {
	const inputs = steps[step].fields.map(
		(name) => formEl?.elements.namedItem(name) as HTMLInputElement | null
	);
	for (const input of inputs) {
		if (input && !input.reportValidity()) return;
	}
	step++;
}
</script>

<svelte:head>
	<title>Set up · Tracemark</title>
</svelte:head>

<div class="grid gap-8">
	<ol class="flex items-center gap-2" aria-label="Setup progress">
		{#each steps as s, i (s.title)}
			<li class="flex flex-1 items-center gap-2">
				<span
					class={[
						'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-all duration-300',
						i < step && 'border-primary bg-primary text-primary-foreground',
						i === step && 'border-primary text-primary ring-4 ring-primary/15',
						i > step && 'text-muted-foreground'
					]}
					aria-current={i === step ? 'step' : undefined}
				>
					{#if i < step}
						<Check class="size-3.5" />
					{:else}
						{i + 1}
					{/if}
				</span>
				{#if i < steps.length - 1}
					<span class="h-px flex-1 overflow-hidden bg-border">
						<span
							class="block h-full bg-primary transition-transform duration-500 ease-out"
							style="transform: scaleX({i < step ? 1 : 0}); transform-origin: left"
						></span>
					</span>
				{/if}
			</li>
		{/each}
	</ol>

	{#key step}
		<div class="grid gap-1 animate-enter">
			<h1 class="text-2xl font-semibold tracking-tight">{steps[step].title}</h1>
			<p class="text-sm text-muted-foreground">{steps[step].description}</p>
		</div>
	{/key}

	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form
		method="POST"
		class="grid gap-4"
		bind:this={formEl}
		onkeydown={(event) => {
			// Enter on an early step moves on instead of submitting half the form.
			if (
				event.key === 'Enter' &&
				step < steps.length - 1 &&
				event.target instanceof HTMLInputElement
			) {
				event.preventDefault();
				next();
			}
		}}
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update({ reset: false });
				pending = false;
			};
		}}
	>
		<!-- Every field stays in the form so one submit sends them all; hidden steps keep their values. -->
		<div class={['grid gap-4', step !== 0 && 'hidden']}>
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
					bind:value={password}
					aria-invalid={form?.errors?.password ? true : undefined}
					aria-describedby="password-hint"
				/>
				<div class="flex gap-1" aria-hidden="true">
					{#each [1, 2, 3, 4] as level (level)}
						<span
							class={[
								'h-1 flex-1 rounded-full transition-colors duration-300',
								strength >= level
									? strength <= 1
										? 'bg-destructive'
										: strength === 2
											? 'bg-warning'
											: 'bg-success'
									: 'bg-muted'
							]}
						></span>
					{/each}
				</div>
				<p id="password-hint" class="text-xs text-muted-foreground">
					{#if form?.errors?.password}
						<span class="text-destructive">{form.errors.password}</span>
					{:else if strengthLabel}
						{strengthLabel}{strength === 1
							? `, use at least ${data.minPasswordLength} characters`
							: ''}
					{:else}
						At least {data.minPasswordLength} characters.
					{/if}
				</p>
			</div>
		</div>

		<div class={['grid gap-4', step !== 1 && 'hidden']}>
			<div class="grid gap-2">
				<Label for="organization">Workspace name</Label>
				<Input
					id="organization"
					name="organization"
					autocomplete="organization"
					placeholder="Acme Inc."
					required
					bind:value={organization}
					aria-invalid={form?.errors?.organization ? true : undefined}
				/>
				{#if form?.errors?.organization}
					<p class="text-sm text-destructive">{form.errors.organization}</p>
				{/if}
			</div>
			<div class="flex items-center gap-3 rounded-xl border border-dashed bg-muted/30 p-3">
				<span
					class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
				>
					{organization.trim().charAt(0).toUpperCase() || 'A'}
				</span>
				<span class="grid text-sm leading-tight">
					<span class="font-medium">{organization.trim() || 'Acme Inc.'}</span>
					<span class="text-xs text-muted-foreground">Owner · 1 member</span>
				</span>
			</div>
		</div>

		<div class="mt-2 flex gap-2">
			{#if step > 0}
				<Button type="button" variant="outline" onclick={() => step--} aria-label="Back">
					<ArrowLeft />
				</Button>
			{/if}
			{#if step < steps.length - 1}
				<Button type="button" class="flex-1" onclick={next}>
					Continue
					<ArrowRight class="transition-transform group-hover/button:translate-x-0.5" />
				</Button>
			{:else}
				<Button type="submit" class="flex-1" disabled={pending}>
					{#if pending}
						<Spinner />
					{/if}
					Create workspace
				</Button>
			{/if}
		</div>
	</form>
</div>
