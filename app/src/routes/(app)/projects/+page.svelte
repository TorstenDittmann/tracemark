<script lang="ts">
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import Check from '@lucide/svelte/icons/check';
import Plus from '@lucide/svelte/icons/plus';
import PageHeader from '#lib/components/page-header.svelte';
import ProjectAvatar from '#lib/components/project-avatar.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Dialog from '#lib/components/ui/dialog/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import * as NativeSelect from '#lib/components/ui/native-select/index.js';
import { Spinner } from '#lib/components/ui/spinner/index.js';
import { enhance } from '$app/forms';
import { replaceState } from '$app/navigation';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let pending = $state(false);
// `?new` (from the project switcher and the command menu) opens the dialog straight away.
let dialogOpen = $state(page.url.searchParams.has('new'));

$effect(() => {
	if (!dialogOpen && page.url.searchParams.has('new')) {
		const url = new URL(page.url.href);
		url.searchParams.delete('new');
		replaceState(url, page.state);
	}
});

const first = $derived(data.projects.length === 0);
const onboarding = [
	{ label: 'Create your workspace', done: true },
	{ label: 'Create a project', done: false },
	{ label: 'Install the SDK', done: false },
	{ label: 'See your first event', done: false }
];
</script>

<svelte:head>
	<title>Projects · Tracemark</title>
</svelte:head>

{#snippet createForm()}
	<form
		method="POST"
		action="?/create"
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
			<Label for="name">Project name</Label>
			<Input
				id="name"
				name="name"
				placeholder="Marketing site"
				required
				maxlength={100}
				value={form?.name ?? ''}
				aria-invalid={form?.error ? true : undefined}
			/>
			<p class="text-xs text-muted-foreground">
				Use one project per website or app. Each gets its own key and its own data.
			</p>
		</div>
		{#if data.organizations.length > 1}
			<div class="grid gap-2">
				<Label for="organization">Workspace</Label>
				<NativeSelect.Root id="organization" name="organization" class="w-full">
					{#each data.organizations as organization (organization.id)}
						<NativeSelect.Option value={organization.id}>{organization.name}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
		{:else if data.organizations[0]}
			<input type="hidden" name="organization" value={data.organizations[0].id}>
		{/if}
		{#if form?.error}
			<p class="text-sm text-destructive" role="alert">{form.error}</p>
		{/if}
		<Button type="submit" disabled={pending}>
			{#if pending}
				<Spinner />
			{/if}
			Create project
			<ArrowRight />
		</Button>
	</form>
{/snippet}

{#if first}
	<div class="mx-auto grid max-w-3xl gap-8 pt-4 md:grid-cols-[1fr_1.2fr] md:pt-10">
		<div class="grid content-start gap-6">
			<div class="grid gap-2">
				<p class="text-sm font-medium text-primary">Welcome, {data.user.name.split(' ')[0]}</p>
				<h1 class="text-3xl font-semibold tracking-tight text-balance">
					Let's get your first project tracking.
				</h1>
				<p class="text-sm text-muted-foreground">
					It takes about two minutes. You'll see events arrive live as soon as the SDK is in.
				</p>
			</div>
			<ol class="grid gap-3 stagger">
				{#each onboarding as item, i (item.label)}
					<li class="flex items-center gap-3 text-sm">
						<span
							class={[
								'flex size-6 items-center justify-center rounded-full border text-xs font-medium',
								item.done && 'border-primary bg-primary text-primary-foreground',
								i === 1 && 'border-primary text-primary ring-4 ring-primary/15'
							]}
						>
							{#if item.done}
								<Check class="size-3.5" />
							{:else}
								{i + 1}
							{/if}
						</span>
						<span
							class={item.done
								? 'text-muted-foreground line-through'
								: i === 1
									? 'font-medium'
									: ''}
						>
							{item.label}
						</span>
					</li>
				{/each}
			</ol>
		</div>
		<div class="self-start rounded-2xl border bg-card p-6 shadow-sm">
			{@render createForm()}
		</div>
	</div>
{:else}
	<div class="grid gap-6">
		<PageHeader title="Projects" description="Each project has its own key and its own events.">
			{#snippet actions()}
				<Button onclick={() => (dialogOpen = true)}>
					<Plus />
					New project
				</Button>
			{/snippet}
		</PageHeader>
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 stagger">
			{#each data.projects as project (project.id)}
				<a
					href="/projects/{project.id}"
					class="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
				>
					<ProjectAvatar id={project.id} name={project.name} class="size-10 rounded-xl text-base" />
					<span class="grid min-w-0 flex-1 leading-tight">
						<span class="truncate font-medium">{project.name}</span>
						<span class="truncate text-sm text-muted-foreground">{project.organizationName}</span>
					</span>
					<ArrowRight
						class="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
					/>
				</a>
			{/each}
			<button
				type="button"
				onclick={() => (dialogOpen = true)}
				class="flex items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
			>
				<Plus class="size-4" />
				New project
			</button>
		</div>
	</div>
{/if}

{#if !first}
	<Dialog.Root bind:open={dialogOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>New project</Dialog.Title>
				<Dialog.Description>You get a public key for your SDK setup right away.</Dialog.Description>
			</Dialog.Header>
			{@render createForm()}
		</Dialog.Content>
	</Dialog.Root>
{/if}
