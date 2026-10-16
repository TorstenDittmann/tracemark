<script lang="ts">
import type { RetentionResult } from '#lib/insights.js';

let { result, start }: { result: RetentionResult; start: string } = $props();

const period = $derived(result.period);
const periodLabel = $derived(period === 'day' ? 'Day' : 'Week');

const cohortFormat = new Intl.DateTimeFormat(undefined, {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

const cohorts = $derived(result.cohorts);
const periods = $derived(Math.max(0, cohorts.length - 1));
const periodIndexes = $derived(Array.from({ length: periods }, (_, n) => n));

/** Share returning in each period, over the cohorts old enough to have reached it. */
const average = $derived(
	Array.from({ length: periods }, (_, n) => {
		let size = 0;
		let returned = 0;
		for (const cohort of cohorts) {
			if (n < cohort.returned.length) {
				size += cohort.size;
				returned += cohort.returned[n];
			}
		}
		return size ? returned / size : null;
	})
);
const total = $derived(cohorts.reduce((sum, cohort) => sum + cohort.size, 0));

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;
</script>

{#snippet cell(
	share: number | null,
	title: string
)}
	{#if share === null}
		<td class="p-0.5"></td>
	{:else}
		<td class="p-0.5">
			<div
				class={[
					'rounded px-2 py-1.5 text-right tabular-nums',
					share >= 0.5 ? 'text-white' : 'text-foreground'
				]}
				style:background="color-mix(in oklab, var(--series-1) {Math.round(
					share * 100
				)}%, transparent)"
				{title}
			>
				{percent(share)}
			</div>
		</td>
	{/if}
{/snippet}

{#if total === 0}
	<p class="py-12 text-center text-sm text-muted-foreground">Nobody did {start} in this range.</p>
{:else}
	<div class="overflow-x-auto">
		<table class="w-full border-separate border-spacing-0 text-sm">
			<thead class="text-xs text-muted-foreground">
				<tr>
					<th class="px-2 py-2 text-left font-normal">Cohort (UTC)</th>
					<th class="px-2 py-2 text-right font-normal">People</th>
					{#each periodIndexes as n (n)}
						<th class="px-2 py-2 text-right font-normal">{periodLabel} {n + 1}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				<tr class="font-medium">
					<td class="px-2 py-1.5">All cohorts</td>
					<td class="px-2 py-1.5 text-right tabular-nums">{total.toLocaleString()}</td>
					{#each average as share, n (n)}
						{@render cell(share, `${periodLabel} ${n + 1}, all cohorts`)}
					{/each}
				</tr>
				{#each cohorts as cohort (cohort.start)}
					{@const label = cohortFormat.format(new Date(cohort.start))}
					<tr>
						<td class="px-2 py-1.5 whitespace-nowrap">
							{period === 'week' ? `Week of ${label}` : label}
						</td>
						<td class="px-2 py-1.5 text-right tabular-nums">
							{cohort.size.toLocaleString()}
						</td>
						{#each periodIndexes as n (n)}
							{@const returned = cohort.returned[n]}
							{@render cell(
								returned === undefined || cohort.size === 0 ? null : returned / cohort.size,
								`${returned ?? 0} of ${cohort.size} people`
							)}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
