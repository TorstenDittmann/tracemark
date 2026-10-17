<script lang="ts">
import type { ExperimentMetric } from '#lib/experiments.js';
import type { VariantSummary } from '#lib/stats.js';

let {
	result
}: { result: { metric: ExperimentMetric; label: string; variants: VariantSummary[] } } = $props();

/** How sure the results must be before one variant is called the winner. */
const DECISIVE = 0.95;

const numberFormat = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const conversion = $derived(result.metric.kind === 'conversion');
const rate = (value: number) => (conversion ? percent.format(value) : decimal.format(value));
const leader = $derived(
	result.variants.reduce<VariantSummary | undefined>(
		(best, v) => (!best || v.chanceToBeBest > best.chanceToBeBest ? v : best),
		undefined
	)
);
const people = $derived(result.variants.reduce((sum, v) => sum + v.people, 0));
</script>

<section class="grid min-w-0 gap-2">
	<div class="flex flex-wrap items-baseline justify-between gap-x-3">
		<h3 class="font-medium">{result.label}</h3>
		<p class="text-sm text-muted-foreground">
			{#if !people}
				Waiting for people to see the flag.
			{:else if leader && leader.chanceToBeBest >= DECISIVE}
				<span class="font-mono text-foreground">{leader.key}</span>
				is very likely best.
			{:else}
				No clear winner yet.
			{/if}
		</p>
	</div>
	<div class="relative overflow-x-auto">
		<table class="data-table w-full text-sm">
			<thead class="text-left text-xs text-muted-foreground">
				<tr>
					<th class="py-2 pr-4 font-normal">Variant</th>
					<th class="px-4 py-2 text-right font-normal">People</th>
					<th class="px-4 py-2 text-right font-normal">{conversion ? 'Converted' : 'Events'}</th>
					<th class="px-4 py-2 text-right font-normal">{conversion ? 'Rate' : 'Per person'}</th>
					<th class="px-4 py-2 text-right font-normal">95% interval</th>
					<th class="py-2 pl-4 font-normal">Chance to be best</th>
				</tr>
			</thead>
			<tbody>
				{#each result.variants as variant (variant.key)}
					<tr class="border-t">
						<td class="max-w-48 truncate py-2 pr-4 font-mono">{variant.key}</td>
						<td class="px-4 py-2 text-right tabular-nums">{numberFormat.format(variant.people)}</td>
						<td class="px-4 py-2 text-right tabular-nums">{numberFormat.format(variant.value)}</td>
						<td class="px-4 py-2 text-right font-medium tabular-nums">{rate(variant.rate)}</td>
						<td class="px-4 py-2 text-right whitespace-nowrap text-muted-foreground tabular-nums">
							{variant.interval
								? `${rate(variant.interval[0])} to ${rate(variant.interval[1])}`
								: '–'}
						</td>
						<td class="py-2 pl-4">
							<div class="flex items-center gap-2">
								<div
									class="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
									aria-hidden="true"
								>
									<div
										class={[
											'h-full rounded-full',
											variant === leader && people ? 'bg-primary' : 'bg-muted-foreground/50'
										]}
										style:width="{variant.chanceToBeBest * 100}%"
									></div>
								</div>
								<span class="tabular-nums">{percent.format(variant.chanceToBeBest)}</span>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
