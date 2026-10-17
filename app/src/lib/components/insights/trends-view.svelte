<script lang="ts">
import LineChart from '#lib/components/charts/line-chart.svelte';
import type { TrendsResult } from '#lib/insights.js';

let {
	result,
	totalLabel,
	compact = false
}: { result: TrendsResult; totalLabel: string; compact?: boolean } = $props();

const valueFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const format = (value: number) => valueFormat.format(value);

const lines = $derived(
	result.lines.map((line, i) => ({
		key: `${line.series}:${line.breakdown ?? ''}:${i}`,
		label:
			line.breakdown === undefined
				? line.label
				: `${line.label} · ${line.breakdown === '' ? 'None' : line.breakdown}`,
		data: line.data,
		total: line.total
	}))
);
</script>

{#if !lines.length}
	<p class="py-12 text-center text-sm text-muted-foreground">No events match this query.</p>
{:else}
	<div class="grid gap-4">
		<LineChart
			{lines}
			buckets={result.buckets}
			bucket={result.bucket}
			{format}
			height={compact ? 180 : 240}
		/>
		{#if !compact}
			<table class="data-table w-full text-sm">
				<thead class="text-left text-xs text-muted-foreground">
					<tr>
						<th class="py-2 font-normal">Series</th>
						<th class="py-2 text-right font-normal">{totalLabel}</th>
					</tr>
				</thead>
				<tbody>
					{#each lines as line, i (line.key)}
						<tr class="border-t">
							<td class="py-2">
								<span class="flex items-center gap-2">
									<span
										class="size-2.5 shrink-0 rounded-full"
										style:background="var(--series-{(i % 8) + 1})"
										aria-hidden="true"
									></span>
									{line.label}
								</span>
							</td>
							<td class="py-2 text-right tabular-nums">{format(line.total)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/if}
