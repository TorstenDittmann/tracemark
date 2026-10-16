<script lang="ts">
import ExperimentStatus from '#lib/components/experiments/experiment-status.svelte';
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { experimentHref } from '#lib/experiments.js';
import { flagsHref } from '#lib/flags.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

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
	<title>Experiments · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>New experiment</Card.Title>
			<Card.Description>
				An experiment compares the variants of a feature flag: who saw which one, and what they did
				afterwards.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if data.flags.length}
				<form method="POST" action="?/create" use:enhance class="grid max-w-xl gap-2">
					<div class="flex flex-wrap gap-2">
						<Input
							name="name"
							placeholder="Cheaper pricing page"
							aria-label="Name"
							value={form?.name ?? ''}
							maxlength={200}
							required
							class="min-w-0 flex-1"
						/>
						<select name="flag" aria-label="Feature flag" class={selectClass} required>
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
					<div><Button type="submit">Create experiment</Button></div>
					{#if form?.message}
						<p class="text-sm text-destructive" role="alert">{form.message}</p>
					{/if}
				</form>
			{:else}
				<p class="text-sm text-muted-foreground">
					Experiments need a <a href={flagsHref(data.project.id)} class="underline">feature flag</a>
					with at least two variants, such as control and test.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0 py-2">
		{#if data.experiments.length}
			<div class="relative overflow-x-auto">
				<table class="w-full text-sm">
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
			<p class="px-6 py-10 text-center text-sm text-muted-foreground">No experiments yet.</p>
		{/if}
	</Card.Root>
</div>
