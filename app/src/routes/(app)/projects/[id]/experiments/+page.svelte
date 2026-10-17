<script lang="ts">
import FlaskConical from '@lucide/svelte/icons/flask-conical';
import Plus from '@lucide/svelte/icons/plus';
import EmptyState from '#lib/components/empty-state.svelte';
import ExperimentStatus from '#lib/components/experiments/experiment-status.svelte';
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import * as Dialog from '#lib/components/ui/dialog/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { experimentHref } from '#lib/experiments.js';
import { flagsHref } from '#lib/flags.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
// Reopen the dialog when the server rejects what was typed.
let creating = $state(false);
$effect(() => {
	if (form?.message) creating = true;
});

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function period(experiment: (typeof data.experiments)[number]): string {
	if (!experiment.startedAt) return 'Not started';
	const from = dateFormat.format(experiment.startedAt);
	return experiment.endedAt
		? `${from} to ${dateFormat.format(experiment.endedAt)}`
		: `Since ${from}`;
}
</script>

<svelte:head>
	<title>Experiments · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">
			{data.experiments.length}
			{data.experiments.length === 1 ? 'experiment' : 'experiments'}
		</p>
		<Dialog.Root bind:open={creating}>
			<Dialog.Trigger>
				{#snippet child({
					props
				})}
					<Button {...props}>
						<Plus />
						New experiment
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title>New experiment</Dialog.Title>
					<Dialog.Description>
						An experiment compares the variants of a feature flag: who saw which one, and what they
						did afterwards.
					</Dialog.Description>
				</Dialog.Header>
				{#if data.flags.length}
					<form method="POST" action="?/create" use:enhance class="grid gap-3">
						<div class="grid gap-2">
							<Input
								name="name"
								placeholder="Cheaper pricing page"
								aria-label="Name"
								value={form?.name ?? ''}
								maxlength={200}
								required
								class="min-w-0 flex-1"
							/>
							<select
								name="flag"
								aria-label="Feature flag"
								class={[selectClass, 'h-9 w-full']}
								required
							>
								{#each data.flags as flag (flag.id)}
									<option value={flag.id} selected={form?.flagId === flag.id}>{flag.key}</option>
								{/each}
							</select>
						</div>
						<Input
							name="description"
							placeholder="What you expect to happen (optional)"
							aria-label="Description"
							value={form?.description ?? ''}
							maxlength={500}
						/>
						<Button type="submit">
							<Plus />
							Create experiment
						</Button>
						{#if form?.message}
							<p class="text-sm text-destructive" role="alert">{form.message}</p>
						{/if}
					</form>
				{:else}
					<p class="text-sm text-muted-foreground">
						Experiments need a
						<a href={flagsHref(data.project.id)} class="underline">feature flag</a>
						with at least two variants, such as control and test.
					</p>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<Card.Root class="min-w-0 py-2">
		{#if data.experiments.length}
			<div class="relative overflow-x-auto">
				<table class="data-table w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Name</th>
							<th class="px-4 py-2 font-normal">Status</th>
							<th class="px-4 py-2 font-normal">Flag</th>
							<th class="px-6 py-2 font-normal">Running</th>
						</tr>
					</thead>
					<tbody>
						{#each data.experiments as experiment (experiment.id)}
							<tr class="border-t">
								<td class="max-w-80 px-6 py-2">
									<a
										href={experimentHref(data.project.id, experiment.id)}
										class="block truncate font-medium hover:underline"
									>
										{experiment.name}
									</a>
								</td>
								<td class="px-4 py-2 whitespace-nowrap">
									<ExperimentStatus status={experiment.status} />
								</td>
								<td class="max-w-48 truncate px-4 py-2 font-mono text-muted-foreground">
									{experiment.flagKey}
								</td>
								<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
									{period(experiment)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<EmptyState
				icon={FlaskConical}
				title="No experiments yet"
				description="Test a multivariate flag's variants against a goal and see which one wins."
			/>
		{/if}
	</Card.Root>
</div>
