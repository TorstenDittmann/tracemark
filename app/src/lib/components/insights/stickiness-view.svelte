<script lang="ts">
/**
 * People by how many days or weeks they did each event on, as bars grouped by that number (one
 * bar per event). Hovering a group shows its counts and shares; a screen-reader table carries
 * the same numbers.
 */
import type { StickinessResult } from '#lib/insights.js';

let { result, compact = false }: { result: StickinessResult; compact?: boolean } = $props();

const height = $derived(compact ? 200 : 280);
const pad = { top: 12, right: 12, bottom: 28, left: 48 };
let width = $state(0);
let hover = $state<number | null>(null);

const color = (series: number) => `var(--series-${(series % 8) + 1})`;

const lines = $derived(result.lines);
const groups = $derived(Array.from({ length: result.intervals }, (_, i) => i));
const max = $derived(Math.max(0, ...lines.flatMap((line) => line.counts)));
const anyone = $derived(lines.some((line) => line.people > 0));

const unit = $derived(result.interval);
/** "1 day", "3 weeks": the intervals of group `i`. */
const intervals = (i: number) => `${i + 1} ${unit}${i === 0 ? '' : 's'}`;
const share = (count: number, people: number) =>
	people ? `${Math.round((count / people) * 100)}%` : '–';

/** A round step for about four gridlines. */
function niceStep(max: number): number {
	if (max <= 4) return 1;
	const raw = max / 4;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
}

const step = $derived(niceStep(Math.max(1, max)));
const top = $derived(Math.max(step, Math.ceil(max / step) * step));
const plotWidth = $derived(Math.max(0, width - pad.left - pad.right));
const plotHeight = $derived(height - pad.top - pad.bottom);
const y = (v: number) => pad.top + ((top - v) / top) * plotHeight;
const band = $derived(groups.length ? plotWidth / groups.length : 0);
/** Bars of a group share 70% of its band, with a 2px gap between them. */
const barWidth = $derived(
	Math.max(1, Math.min(40, (band * 0.7) / Math.max(1, lines.length) - (lines.length > 1 ? 2 : 0)))
);
const groupWidth = $derived(lines.length * barWidth + (lines.length - 1) * 2);
const x = (i: number) => pad.left + band * i + band / 2;
const barX = (i: number, series: number) => x(i) - groupWidth / 2 + series * (barWidth + 2);
const gridlines = $derived(
	Array.from({ length: Math.round(top / step) + 1 }, (_, i) => top - i * step)
);

/** The whole band of a group is its hover target, wider than the bars. */
function onpointermove(event: PointerEvent) {
	const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
	const i = Math.floor((event.clientX - rect.left - pad.left) / Math.max(1, band));
	hover = i >= 0 && i < groups.length ? i : null;
}

const ticks = $derived.by(() => {
	const count = Math.min(groups.length, Math.max(2, Math.floor(plotWidth / 36)));
	const every = Math.ceil(groups.length / Math.max(1, count));
	return groups.filter((i) => i % every === 0);
});
</script>

{#if !anyone}
	<p class="py-12 text-center text-sm text-muted-foreground">Nobody did this in the range.</p>
{:else}
	<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
		{#each lines as line (line.series)}
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm" style:background={color(line.series)}></span>
				{line.label}
				{#if !compact}
					<span class="tabular-nums">· {line.people.toLocaleString()} people</span>
				{/if}
			</li>
		{/each}
	</ul>

	<div class="relative" bind:clientWidth={width} style:height="{height}px">
		{#if width > 0}
			<svg
				{width}
				{height}
				role="img"
				aria-label="People by number of {unit}s active"
				class="block touch-none select-none"
				{onpointermove}
				onpointerleave={() => (hover = null)}
			>
				{#each gridlines as value (value)}
					<line
						x1={pad.left}
						x2={width - pad.right}
						y1={y(value)}
						y2={y(value)}
						class="stroke-border"
						stroke-width="1"
						stroke-dasharray={value === 0 ? undefined : '3 4'}
					/>
					<text
						x={pad.left - 8}
						y={y(value)}
						dy="0.32em"
						text-anchor="end"
						class="fill-muted-foreground text-[11px] tabular-nums"
					>
						{value.toLocaleString()}
					</text>
				{/each}
				{#each ticks as i (i)}
					<text
						x={x(i)}
						y={height - 8}
						text-anchor="middle"
						class="fill-muted-foreground text-[11px] tabular-nums"
					>
						{i + 1}{result.cumulative ? '+' : ''}
					</text>
				{/each}
				{#each groups as i (i)}
					<g opacity={hover === null || hover === i ? 1 : 0.55}>
						{#each lines as line (line.series)}
							{#if line.counts[i] > 0}
								<rect
									x={barX(i, line.series)}
									y={y(line.counts[i])}
									width={barWidth}
									height={Math.max(1, y(0) - y(line.counts[i]))}
									rx="2"
									style:fill={color(line.series)}
								/>
							{/if}
						{/each}
					</g>
				{/each}
			</svg>
			{#if hover !== null}
				<div
					class="pointer-events-none absolute top-0 z-10 w-56 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur"
					style:left="{x(hover)}px"
					style:transform="translateX({x(hover) > width / 2 ? 'calc(-100% - 16px)' : '16px'})"
				>
					<div class="text-muted-foreground">
						Active on {result.cumulative ? 'at least' : 'exactly'}
						{intervals(hover)}
					</div>
					{#each lines as line (line.series)}
						<div class="mt-1 flex items-center gap-2">
							<span class="size-2 shrink-0 rounded-sm" style:background={color(line.series)}></span>
							<span class="truncate">{line.label}</span>
							<span class="ml-auto pl-3 font-medium tabular-nums">
								{line.counts[hover].toLocaleString()}
							</span>
							<span class="w-9 text-right text-muted-foreground tabular-nums">
								{share(line.counts[hover], line.people)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
	{#if !compact}
		<p class="mt-1 text-center text-xs text-muted-foreground">
			{result.cumulative ? 'At least this many' : 'Number of'}
			{unit}s active, out of {result.intervals}
		</p>
	{/if}

	<!-- Tables ignore sr-only sizing, so the wrapper carries it. -->
	<div class="sr-only">
		<table>
			<caption>
				People by number of {unit}s active
			</caption>
			<thead>
				<tr>
					<th>Active on</th>
					{#each lines as line (line.series)}
						<th>{line.label}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each groups as i (i)}
					<tr>
						<td>{result.cumulative ? 'At least ' : ''}{intervals(i)}</td>
						{#each lines as line (line.series)}
							<td>{line.counts[i]}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
