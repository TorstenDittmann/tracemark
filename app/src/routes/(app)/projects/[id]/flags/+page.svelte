<script lang="ts">
import ToggleRight from '@lucide/svelte/icons/toggle-right';
import EmptyState from '#lib/components/empty-state.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { flagHref, flagKind, flagSummary } from '#lib/flags.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

<svelte:head>
	<title>Feature flags · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>New flag</Card.Title>
			<Card.Description>
				Your code asks for a flag by its key. New flags start off, so nothing changes until you turn
				one on.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/create" use:enhance class="grid max-w-xl gap-2">
				<div class="flex flex-wrap gap-2">
					<Input
						name="key"
						placeholder="new-checkout"
						aria-label="Flag key"
						value={form?.key ?? ''}
						maxlength={100}
						required
						class="w-56 font-mono"
					/>
					<Input
						name="description"
						placeholder="What it's for (optional)"
						aria-label="Description"
						value={form?.description ?? ''}
						maxlength={500}
						class="min-w-0 flex-1"
					/>
				</div>
				<div><Button type="submit">Create flag</Button></div>
				{#if form?.message}
					<p class="text-sm text-destructive" role="alert">{form.message}</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>

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
									<span
										class={[
											'inline-flex items-center gap-1.5',
											flag.active ? '' : 'text-muted-foreground'
										]}
									>
										<span
											class={[
												'size-2 rounded-full',
												flag.active ? 'bg-primary' : 'bg-muted-foreground/40'
											]}
											aria-hidden="true"
										></span>
										{flag.active ? 'On' : 'Off'}
									</span>
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
				description="Create one above, then ask for it by key in your code. New flags start off."
			/>
		{/if}
	</Card.Root>
</div>
