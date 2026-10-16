<script lang="ts">
import { COHORT_KINDS, cohortHref } from '#lib/cohorts.js';
import PeopleNav from '#lib/components/people/people-nav.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

<svelte:head>
	<title>Cohorts · {data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-4">
	<PeopleNav projectId={data.project.id} />

	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>New cohort</Card.Title>
			<Card.Description>
				A named set of people to narrow insights to: a list you keep, or everyone whose person
				properties match.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/create" use:enhance class="grid gap-4">
				<fieldset class="grid gap-2 text-sm">
					<legend class="mb-2 font-medium">Defined by</legend>
					{#each Object.entries(COHORT_KINDS) as [value, label], i (value)}
						<label class="flex items-center gap-2">
							<input
								type="radio"
								name="kind"
								{value}
								checked={form?.kind ? form.kind === value : i === 0}
							>
							{label}
							<span class="text-muted-foreground">
								{value === 'static'
									? 'people you add by id'
									: 'everyone matching filters, kept up to date'}
							</span>
						</label>
					{/each}
				</fieldset>
				<div class="flex max-w-md gap-2">
					<Input
						name="name"
						placeholder="Cohort name"
						aria-label="Cohort name"
						value={form?.name ?? ''}
					/>
					<Button type="submit">Create cohort</Button>
				</div>
				{#if form?.message}
					<p class="text-sm text-destructive" role="alert">{form.message}</p>
				{/if}
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0 py-2">
		{#if data.cohorts.length}
			<div class="relative overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Name</th>
							<th class="px-4 py-2 font-normal">Defined by</th>
							<th class="px-4 py-2 text-right font-normal">People</th>
							<th class="px-6 py-2 font-normal">Updated</th>
						</tr>
					</thead>
					<tbody>
						{#each data.cohorts as cohort (cohort.id)}
							<tr class="border-t">
								<td class="px-6 py-2">
									<a
										href={cohortHref(data.project.id, cohort.id)}
										class="font-medium hover:underline"
									>
										{cohort.name}
									</a>
								</td>
								<td class="px-4 py-2 text-muted-foreground">{COHORT_KINDS[cohort.kind]}</td>
								<td class="px-4 py-2 text-right tabular-nums">
									{cohort.size === null ? '–' : cohort.size.toLocaleString()}
								</td>
								<td class="px-6 py-2 whitespace-nowrap text-muted-foreground">
									{dateFormat.format(cohort.updatedAt)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="px-6 py-10 text-center text-sm text-muted-foreground">No cohorts yet.</p>
		{/if}
	</Card.Root>
</div>
