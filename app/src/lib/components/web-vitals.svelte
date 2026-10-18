<script lang="ts">
import StatusPill from '#lib/components/status-pill.svelte';
import * as Card from '#lib/components/ui/card/index.js';
import {
	formatVital,
	rateVital,
	VITAL_FILTERS,
	VITALS,
	type Vital,
	type VitalRating,
	type WebFilters,
	type WebVitals
} from '#lib/web.js';

let { vitals, filters }: { vitals: WebVitals; filters: WebFilters } = $props();

const names = Object.keys(VITALS) as Vital[];

const tones = { good: 'success', 'needs-improvement': 'warning', poor: 'destructive' } as const;
const labels: Record<VitalRating, string> = {
	good: 'Good',
	'needs-improvement': 'Needs improvement',
	poor: 'Poor'
};
const colors: Record<VitalRating, string> = {
	good: 'text-success',
	'needs-improvement': 'text-amber-700 dark:text-amber-300',
	poor: 'text-destructive'
};

const empty = $derived(names.every((name) => vitals.vitals[name].samples === 0));
const ignored = $derived(
	Object.keys(filters).some((key) => !(VITAL_FILTERS as readonly string[]).includes(key))
);
</script>

<Card.Root class="gap-4">
	<Card.Header>
		<Card.Title>Web vitals</Card.Title>
		<Card.Description>
			75th percentile of page views, rated by Google's thresholds.
			{#if ignored}
				Source, entry and exit filters don't apply here.
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-5">
		{#if empty}
			<p class="py-6 text-center text-sm text-muted-foreground">
				No web vitals for this range. Set <code class="font-mono">autocaptureWebVitals: true</code>
				in the browser SDK to measure them.
			</p>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{#each names as name (name)}
					{@const { p75, samples } = vitals.vitals[name]}
					<div class="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3">
						<span class="truncate text-sm text-muted-foreground" title={VITALS[name].label}>
							{name}
						</span>
						{#if p75 === null}
							<span class="text-xl font-semibold text-muted-foreground">–</span>
							<span class="text-xs text-muted-foreground">Not measured</span>
						{:else}
							{@const rating = rateVital(name, p75)}
							<span class={['text-xl font-semibold tracking-tight tabular-nums', colors[rating]]}>
								{formatVital(name, p75)}
							</span>
							<div class="flex flex-wrap items-center gap-1.5">
								<StatusPill tone={tones[rating]}>{labels[rating]}</StatusPill>
								<span class="text-xs text-muted-foreground tabular-nums">
									{samples.toLocaleString()}
									views
								</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="overflow-x-auto">
				<table class="data-table w-full min-w-[36rem] text-left text-sm">
					<caption class="sr-only">
						Web vitals by path
					</caption>
					<thead class="text-xs text-muted-foreground">
						<tr>
							<th scope="col" class="py-1.5 pr-4 font-normal">Path</th>
							<th scope="col" class="py-1.5 pr-4 text-right font-normal">Views</th>
							{#each names as name (name)}
								<th
									scope="col"
									class="py-1.5 pl-4 text-right font-normal"
									title={VITALS[name].label}
								>
									{name}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each vitals.paths as row (row.path)}
							<tr class="border-t">
								<th scope="row" class="max-w-64 truncate py-1.5 pr-4 font-normal" title={row.path}>
									{row.path || 'Unknown'}
								</th>
								<td class="py-1.5 pr-4 text-right text-muted-foreground tabular-nums">
									{row.pageviews.toLocaleString()}
								</td>
								{#each names as name (name)}
									{@const p75 = row.vitals[name].p75}
									<td
										class={[
											'py-1.5 pl-4 text-right whitespace-nowrap tabular-nums',
											p75 === null ? 'text-muted-foreground' : colors[rateVital(name, p75)]
										]}
									>
										{p75 === null ? '–' : formatVital(name, p75)}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
