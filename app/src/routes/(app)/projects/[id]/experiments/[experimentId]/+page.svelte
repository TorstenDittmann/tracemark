<script lang="ts">
import ExperimentStatus from '#lib/components/experiments/experiment-status.svelte';
import MetricResults from '#lib/components/experiments/metric-results.svelte';
import SampleSize from '#lib/components/experiments/sample-size.svelte';
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { type ExperimentMetric, experimentsHref, MAX_METRICS } from '#lib/experiments.js';
import { flagHref } from '#lib/flags.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const numberFormat = new Intl.NumberFormat();
const experiment = $derived(data.experiment);

// Edited locally; reset whenever the saved metrics change.
let metrics: ExperimentMetric[] = $state([]);
$effect.pre(() => {
	metrics = data.experiment.metrics.map((metric) => ({ ...metric }));
});

const status = $derived(
	form && ['launch', 'stop', 'save'].includes(String(form.action)) ? form : undefined
);
const exposed = $derived(data.results?.exposures.reduce((sum, e) => sum + e.people, 0) ?? 0);
</script>

<svelte:head>
	<title>{experiment.name} · {data.project.name} · Tracemark</title>
</svelte:head>

<datalist id="experiment-events">
	{#each data.events as event (event)}
		<option value={event}></option>
	{/each}
</datalist>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="grid min-w-0 gap-0.5">
			<a
				href={experimentsHref(data.project.id)}
				class="text-sm text-muted-foreground hover:underline"
			>
				Experiments
			</a>
			<h2 class="truncate text-xl font-semibold">{experiment.name}</h2>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<ExperimentStatus status={experiment.status} />
				{#if data.flag}
					<a href={flagHref(data.project.id, data.flag.id)} class="font-mono hover:underline">
						{data.flag.key}
					</a>
				{/if}
				{#if experiment.startedAt}
					<span class="text-muted-foreground">
						{experiment.endedAt
							? `${dateFormat.format(experiment.startedAt)} to ${dateFormat.format(experiment.endedAt)}`
							: `Since ${dateFormat.format(experiment.startedAt)}`}
					</span>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-1">
			{#if experiment.status === 'draft'}
				<form method="POST" action="?/launch" use:enhance>
					<Button
						type="submit"
						size="sm"
						onclick={(e) => {
							if (
								data.flag &&
								!data.flag.active &&
								!confirm(`Launching turns on the flag ${data.flag.key}. Launch now?`)
							)
								e.preventDefault();
						}}
					>
						Launch
					</Button>
				</form>
			{:else if experiment.status === 'running'}
				<form method="POST" action="?/stop" use:enhance>
					<Button type="submit" size="sm" variant="outline">Stop</Button>
				</form>
			{/if}
			<form method="POST" action="?/delete" use:enhance>
				<Button
					type="submit"
					size="sm"
					variant="ghost"
					onclick={(e) => {
						if (!confirm(`Delete the experiment ${experiment.name}? The flag stays as it is.`))
							e.preventDefault();
					}}
				>
					Delete
				</Button>
			</form>
		</div>
	</div>
	{#if experiment.description}
		<p class="text-sm text-muted-foreground">{experiment.description}</p>
	{/if}
	{#if status && status.action !== 'save'}
		<p class={['text-sm', status.ok ? 'text-muted-foreground' : 'text-destructive']} role="status">
			{status.message}
		</p>
	{/if}

	{#if experiment.status !== 'draft'}
		<Card.Root class="min-w-0 gap-4">
			<Card.Header>
				<Card.Title>Results</Card.Title>
				<Card.Description>
					{#if data.results}
						{numberFormat.format(exposed)}
						{exposed === 1 ? 'person' : 'people'}
						saw a variant. Each counts in the first variant they were served, and only what they did
						after that counts.
					{:else if data.resultsFailed}
						Results are unavailable right now.
					{:else}
						The flag no longer has variants to compare.
					{/if}
				</Card.Description>
			</Card.Header>
			{#if data.results}
				<Card.Content class="grid gap-6">
					{#each data.results.metrics as result, i (i)}
						<MetricResults {result} />
					{:else}
						<p class="text-sm text-muted-foreground">Add a metric to see results.</p>
					{/each}
				</Card.Content>
			{/if}
		</Card.Root>
	{/if}

	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>Setup</Card.Title>
			<Card.Description>
				A conversion metric is the share of people who did an event at least once. A count metric is
				how often they did it, per person.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/save"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="grid max-w-2xl gap-3"
			>
				<input type="hidden" name="metrics" value={JSON.stringify(metrics)}>
				<Input name="name" aria-label="Name" value={experiment.name} maxlength={200} required />
				<Input
					name="description"
					aria-label="Description"
					placeholder="What you expect to happen (optional)"
					value={experiment.description}
					maxlength={500}
				/>
				<div class="grid gap-2">
					<span class="text-sm font-medium">Metrics</span>
					{#each metrics as metric, i (i)}
						<div class="flex flex-wrap items-center gap-2">
							<select class={selectClass} aria-label="Metric type" bind:value={metric.kind}>
								<option value="conversion">Conversion</option>
								<option value="count">Count per person</option>
							</select>
							<Input
								aria-label="Event"
								placeholder="purchase"
								list="experiment-events"
								bind:value={metric.event}
								maxlength={200}
								class="min-w-40 flex-1 font-mono"
							/>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								aria-label="Remove metric"
								onclick={() => metrics.splice(i, 1)}
							>
								Remove
							</Button>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No metrics yet.</p>
					{/each}
					{#if metrics.length < MAX_METRICS}
						<div>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onclick={() => metrics.push({ kind: 'conversion', event: data.events[0] ?? '' })}
							>
								Add metric
							</Button>
						</div>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<Button type="submit">Save</Button>
					{#if status?.action === 'save'}
						<p
							class={['text-sm', status.ok ? 'text-muted-foreground' : 'text-destructive']}
							role="status"
						>
							{status.message}
						</p>
					{/if}
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<SampleSize variants={data.flag?.variants.length ?? 2} />
</div>
