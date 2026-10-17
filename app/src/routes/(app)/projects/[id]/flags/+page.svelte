<script lang="ts">
import Plus from '@lucide/svelte/icons/plus';
import ToggleRight from '@lucide/svelte/icons/toggle-right';
import EmptyState from '#lib/components/empty-state.svelte';
import StatusPill from '#lib/components/status-pill.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import * as Dialog from '#lib/components/ui/dialog/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { flagHref, flagKind, flagSummary } from '#lib/flags.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
// Reopen the dialog when the server rejects what was typed.
let creating = $state(false);
$effect(() => {
	if (form?.message) creating = true;
});

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

<svelte:head>
	<title>Feature flags · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">
			{data.flags.length}
			{data.flags.length === 1 ? 'flag' : 'flags'}
		</p>
		<Dialog.Root bind:open={creating}>
			<Dialog.Trigger>
				{#snippet child({
					props
				})}
					<Button {...props}>
						<Plus />
						New flag
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title>New feature flag</Dialog.Title>
					<Dialog.Description>
						Your code asks for a flag by its key. New flags start off, so nothing changes until you
						turn one on.
					</Dialog.Description>
				</Dialog.Header>
				<form method="POST" action="?/create" use:enhance class="grid gap-3">
					<div class="grid gap-2">
						<Input
							name="key"
							placeholder="new-checkout"
							aria-label="Flag key"
							value={form?.key ?? ''}
							maxlength={100}
							required
							class="font-mono"
						/>
						<Input
							name="description"
							placeholder="What it's for (optional)"
							aria-label="Description"
							value={form?.description ?? ''}
							maxlength={500}
						/>
					</div>
					<Button type="submit">
						<Plus />
						Create flag
					</Button>
					{#if form?.message}
						<p class="text-sm text-destructive" role="alert">{form.message}</p>
					{/if}
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<Card.Root class="min-w-0 py-2">
		{#if data.flags.length}
			<div class="relative overflow-x-auto">
				<table class="data-table w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Key</th>
							<th class="px-4 py-2 font-normal">Status</th>
							<th class="px-4 py-2 font-normal">Type</th>
							<th class="px-4 py-2 font-normal">Rollout</th>
							<th class="px-6 py-2 font-normal">Updated</th>
						</tr>
					</thead>
					<tbody>
						{#each data.flags as flag (flag.id)}
							<tr class="border-t">
								<td class="max-w-80 px-6 py-2">
									<a
										href={flagHref(data.project.id, flag.id)}
										class="block truncate font-mono font-medium hover:underline"
									>
										{flag.key}
									</a>
									{#if flag.description}
										<span class="block truncate text-xs text-muted-foreground">
											{flag.description}
										</span>
									{/if}
								</td>
								<td class="px-4 py-2 whitespace-nowrap">
									<StatusPill tone={flag.active ? 'success' : 'muted'}>
										{flag.active ? 'On' : 'Off'}
									</StatusPill>
								</td>
								<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
									{flag.definition ? flagKind(flag.definition) : 'Invalid'}
								</td>
								<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
									{flag.definition ? flagSummary(flag.definition) : '–'}
								</td>
								<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
									{dateFormat.format(flag.updatedAt)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<EmptyState
				icon={ToggleRight}
				title="No feature flags yet"
				description="Create one, then ask for it by key in your code. New flags start off, so nothing changes until you turn one on."
			/>
		{/if}
	</Card.Root>
</div>
