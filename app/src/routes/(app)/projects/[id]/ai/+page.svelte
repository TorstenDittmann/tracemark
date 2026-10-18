<script lang="ts">
import { formatCost, formatDuration, formatScore, formatTokens } from '#lib/ai.js';
import AiNav from '#lib/components/ai/ai-nav.svelte';
import LineChart from '#lib/components/charts/line-chart.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import { personHref } from '#lib/persons.js';
import { RANGES } from '#lib/web.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

type Metric = 'cost' | 'calls';
let metric = $state<Metric>('cost');

let scoreName = $state<string | null>(null);
const score = $derived(
	data.overview?.scores.find((s) => s.name === scoreName) ?? data.overview?.scores[0] ?? null
);
const scoreModels = $derived(
	score ? (data.overview?.modelScores ?? []).filter((m) => m.name === score.name) : []
);

const rangeLabel = $derived(RANGES[data.range].label.toLowerCase());
const tiles = $derived(
	data.overview
		? [
				{ label: 'Cost', value: formatCost(data.overview.totals.cost) },
				{ label: 'Calls', value: data.overview.totals.calls.toLocaleString() },
				{ label: 'Traces', value: data.overview.totals.traces.toLocaleString() },
				{
					label: 'Tokens',
					value: formatTokens(data.overview.totals.inputTokens + data.overview.totals.outputTokens),
					detail: `${formatTokens(data.overview.totals.inputTokens)} in, ${formatTokens(data.overview.totals.outputTokens)} out`
				},
				{ label: 'Avg latency', value: formatDuration(data.overview.totals.avgLatency) },
				{ label: 'Errors', value: data.overview.totals.errors.toLocaleString() }
			]
		: []
);
const tracesHref = (person?: string, scored?: string) => {
	const params = new URLSearchParams({ range: data.range });
	if (person) params.set('person', person);
	if (scored) params.set('score', scored);
	return `/projects/${data.project.id}/ai/traces?${params}`;
};
</script>

<svelte:head>
	<title>AI · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<AiNav projectId={data.project.id} current="overview" range={data.range} />

	{#if !data.overview}
		<p class="text-sm text-muted-foreground">
			AI usage is unavailable because ClickHouse could not be reached.
		</p>
	{:else if !data.overview.totals.calls}
		<Card.Root>
			<Card.Content class="grid justify-items-center gap-1 py-6 text-center text-sm">
				<p class="font-medium">No LLM calls in the {rangeLabel}.</p>
				<p class="text-muted-foreground">
					Wrap your Anthropic, OpenAI or Vercel AI SDK client with the Node SDK, or send
					OpenTelemetry traces. See
					<a
						class="underline"
						href="https://github.com/TorstenDittmann/footprint/blob/main/docs/ai.md"
						>docs/ai.md</a
					>.
				</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
			{#each tiles as tile (tile.label)}
				<Card.Root class="gap-1 py-4">
					<Card.Header class="px-4">
						<Card.Description>{tile.label}</Card.Description>
						<Card.Title class="text-2xl tabular-nums">{tile.value}</Card.Title>
						{#if 'detail' in tile}
							<span class="text-xs text-muted-foreground tabular-nums">{tile.detail}</span>
						{/if}
					</Card.Header>
				</Card.Root>
			{/each}
		</div>

		<Card.Root class="gap-4">
			<Card.Header class="flex flex-row items-center justify-between gap-2">
				<Card.Title>{metric === 'cost' ? 'Cost' : 'Calls'}</Card.Title>
				<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
					<legend class="sr-only">Metric</legend>
					{#each ['cost', 'calls'] as const as option (option)}
						<button
							type="button"
							aria-pressed={metric === option}
							onclick={() => (metric = option)}
							class={[
								'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
								metric === option
									? 'bg-background text-foreground shadow-sm dark:bg-input/40'
									: 'text-muted-foreground hover:text-foreground'
							]}
						>
							{option === 'cost' ? 'Cost' : 'Calls'}
						</button>
					{/each}
				</fieldset>
			</Card.Header>
			<Card.Content>
				<LineChart
					lines={[
						{
							key: metric,
							label: metric === 'cost' ? 'Cost' : 'Calls',
							data: data.overview[metric]
						}
					]}
					buckets={data.overview.buckets}
					bucket={data.overview.bucket}
					format={metric === 'cost' ? formatCost : (value) => value.toLocaleString()}
				/>
			</Card.Content>
		</Card.Root>

		{#if score}
			<Card.Root class={['min-w-0 gap-4', scoreModels.length && 'pb-0']}>
				<Card.Header class="flex flex-row flex-wrap items-center justify-between gap-2">
					<div class="grid gap-1">
						<Card.Title>Scores</Card.Title>
						<Card.Description>
							<a class="hover:underline" href={tracesHref(undefined, score.name)}>
								{score.name}: {formatScore(score.avg)} on average,
								{score.count.toLocaleString()}
								{score.count === 1 ? 'score' : 'scores'}
							</a>
						</Card.Description>
					</div>
					{#if data.overview.scores.length > 1}
						<fieldset class="inline-flex flex-wrap rounded-lg bg-muted p-0.5 text-sm">
							<legend class="sr-only">Score</legend>
							{#each data.overview.scores as option (option.name)}
								<button
									type="button"
									aria-pressed={score.name === option.name}
									onclick={() => (scoreName = option.name)}
									class={[
										'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
										score.name === option.name
											? 'bg-background text-foreground shadow-sm dark:bg-input/40'
											: 'text-muted-foreground hover:text-foreground'
									]}
								>
									{option.name}
								</button>
							{/each}
						</fieldset>
					{/if}
				</Card.Header>
				<Card.Content>
					<LineChart
						lines={[{ key: score.name, label: `Average ${score.name}`, data: score.series }]}
						buckets={data.overview.buckets}
						bucket={data.overview.bucket}
						format={formatScore}
					/>
				</Card.Content>
				{#if scoreModels.length}
					<div class="relative overflow-x-auto">
						<table class="data-table w-full text-sm">
							<caption class="sr-only">
								Average {score.name} by model in the {rangeLabel}
							</caption>
							<thead class="text-left text-xs text-muted-foreground">
								<tr>
									<th class="px-6 py-2 font-normal">Model</th>
									<th class="px-4 py-2 text-right font-normal">Scores</th>
									<th class="px-6 py-2 text-right font-normal">Average {score.name}</th>
								</tr>
							</thead>
							<tbody>
								{#each scoreModels as model (model.model)}
									<tr class="border-t">
										<td class="max-w-[12rem] px-6 py-2 sm:max-w-[24rem]">
											<span class="block truncate font-medium" title={model.model}
												>{model.model}</span
											>
										</td>
										<td class="px-4 py-2 text-right tabular-nums">
											{model.count.toLocaleString()}
										</td>
										<td class="px-6 py-2 text-right tabular-nums">{formatScore(model.avg)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card.Root>
		{/if}

		<Card.Root class="min-w-0 gap-3 pb-0">
			<Card.Header>
				<Card.Title>By model</Card.Title>
			</Card.Header>
			<div class="relative overflow-x-auto">
				<table class="data-table w-full text-sm">
					<caption class="sr-only">
						LLM usage by model in the {rangeLabel}
					</caption>
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="px-6 py-2 font-normal">Model</th>
							<th class="px-4 py-2 text-right font-normal">Calls</th>
							<th class="hidden px-4 py-2 text-right font-normal sm:table-cell">Tokens in</th>
							<th class="hidden px-4 py-2 text-right font-normal sm:table-cell">Tokens out</th>
							<th class="hidden px-4 py-2 text-right font-normal md:table-cell">Avg latency</th>
							<th class="hidden px-4 py-2 text-right font-normal md:table-cell">Errors</th>
							<th class="px-6 py-2 text-right font-normal">Cost</th>
						</tr>
					</thead>
					<tbody>
						{#each data.overview.models as model (model.model)}
							<tr class="border-t">
								<td class="max-w-[12rem] px-6 py-2 sm:max-w-[24rem]">
									<span class="block truncate font-medium" title={model.model}>{model.model}</span>
									{#if model.provider}
										<span class="block truncate text-xs text-muted-foreground"
											>{model.provider}</span
										>
									{/if}
								</td>
								<td class="px-4 py-2 text-right tabular-nums">{model.calls.toLocaleString()}</td>
								<td class="hidden px-4 py-2 text-right tabular-nums sm:table-cell">
									{formatTokens(model.inputTokens)}
								</td>
								<td class="hidden px-4 py-2 text-right tabular-nums sm:table-cell">
									{formatTokens(model.outputTokens)}
								</td>
								<td class="hidden px-4 py-2 text-right tabular-nums md:table-cell">
									{formatDuration(model.avgLatency)}
								</td>
								<td class="hidden px-4 py-2 text-right tabular-nums md:table-cell">
									{model.errors.toLocaleString()}
								</td>
								<td class="px-6 py-2 text-right tabular-nums">{formatCost(model.cost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card.Root>

		<Card.Root class="min-w-0 gap-3 pb-0">
			<Card.Header>
				<Card.Title>By person</Card.Title>
				<Card.Description>Calls made on behalf of an identified person.</Card.Description>
			</Card.Header>
			{#if data.overview.people.length}
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<caption class="sr-only">
							LLM usage by person in the {rangeLabel}
						</caption>
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="px-6 py-2 font-normal">Person</th>
								<th class="px-4 py-2 text-right font-normal">Calls</th>
								<th class="px-4 py-2 text-right font-normal">Traces</th>
								<th class="px-6 py-2 text-right font-normal">Cost</th>
							</tr>
						</thead>
						<tbody>
							{#each data.overview.people as person (person.person)}
								<tr class="border-t">
									<td class="max-w-[10rem] px-6 py-2 sm:max-w-[24rem]">
										<a
											class="block truncate font-medium hover:underline"
											href={personHref(data.project.id, person.person)}
											>{person.person}</a
										>
									</td>
									<td class="px-4 py-2 text-right tabular-nums">{person.calls.toLocaleString()}</td>
									<td class="px-4 py-2 text-right tabular-nums">
										<a class="hover:underline" href={tracesHref(person.person)}>
											{person.traces.toLocaleString()}
										</a>
									</td>
									<td class="px-6 py-2 text-right tabular-nums">{formatCost(person.cost)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="px-6 pb-6 text-sm text-muted-foreground">
					No calls carried a person. Pass <code>distinctId</code> to the SDK to see who spends what.
				</p>
			{/if}
		</Card.Root>
	{/if}
</div>
