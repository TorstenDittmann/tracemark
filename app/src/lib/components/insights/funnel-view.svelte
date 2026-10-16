<script lang="ts">
import type { FunnelResult } from '#lib/insights.js';

let {
	result,
	breakdown,
	compact = false
}: { result: FunnelResult; breakdown?: string; compact?: boolean } = $props();

const percent = (part: number, whole: number) =>
	whole === 0 ? '0%' : `${Math.round((part / whole) * 1000) / 10}%`;

const counts = $derived(result.total.counts);
const entered = $derived(counts[0] ?? 0);
const converted = $derived(counts.at(-1) ?? 0);
</script>

<div class="grid gap-5">
	<div class="grid gap-1">
		<div class="text-sm text-muted-foreground">Converted</div>
		<div class={['font-semibold tabular-nums', compact ? 'text-2xl' : 'text-3xl']}>
			{percent(converted, entered)}
		</div>
		<div class="text-sm text-muted-foreground">
			{converted.toLocaleString()}
			of {entered.toLocaleString()} people who entered
		</div>
	</div>

	{#if entered === 0}
		<p class="py-8 text-center text-sm text-muted-foreground">
			Nobody did the first step in this range.
		</p>
	{:else}
		<ol
			class="grid gap-3"
			style:grid-template-columns="repeat({result.steps.length}, minmax(0, 1fr))"
		>
			{#each result.steps as step, i (i)}
				{@const count = counts[i]}
				<li class="grid min-w-0 gap-2 text-sm">
					<div class="truncate">
						<span class="font-medium tabular-nums">{count.toLocaleString()}</span>
						<span class="text-muted-foreground">· {percent(count, entered)}</span>
					</div>
					<div
						class={['relative overflow-hidden rounded bg-muted', compact ? 'h-28' : 'h-48']}
						title="{step}: {count.toLocaleString()} people, {percent(count, entered)} of entered"
					>
						<div
							class="absolute inset-x-0 bottom-0 rounded bg-series-1"
							style:height="{(count / entered) * 100}%"
						></div>
					</div>
					<div class="min-w-0">
						<div class="truncate font-medium" title={step}>{i + 1}. {step}</div>
						{#if i > 0}
							<div class="text-xs text-muted-foreground">
								{percent(count, counts[i - 1])}
								of previous
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/if}

	{#if !compact && result.groups.length}
		<div class="relative overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="text-left text-xs text-muted-foreground">
					<tr>
						<th class="py-2 pr-4 font-normal">{breakdown}</th>
						{#each result.steps as step, i (i)}
							<th class="px-4 py-2 text-right font-normal">{i + 1}. {step}</th>
						{/each}
						<th class="py-2 pl-4 text-right font-normal">Converted</th>
					</tr>
				</thead>
				<tbody>
					{#each result.groups as group (group.breakdown)}
						<tr class="border-t">
							<td class="py-2 pr-4">{group.breakdown || 'None'}</td>
							{#each group.counts as count, i (i)}
								<td class="px-4 py-2 text-right tabular-nums">{count.toLocaleString()}</td>
							{/each}
							<td class="py-2 pl-4 text-right font-medium tabular-nums">
								{percent(group.counts.at(-1) ?? 0, group.counts[0])}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
