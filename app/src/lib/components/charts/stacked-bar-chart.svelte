<script lang="ts">
import type { ChartLine } from './line-chart.svelte';

/**
 * Series stacked into one bar per day, with a tooltip and a screen-reader table. Colors follow
 * the categorical palette in series order, as in the line chart. Buckets are UTC days.
 */
let {
	series,
	buckets,
	height = 240,
	format = (value: number) => value.toLocaleString()
}: {
	/** Nulls count as zero. */
	series: ChartLine[];
	buckets: string[];
	height?: number;
	format?: (value: number) => string;
} = $props();

const pad = { top: 12, right: 12, bottom: 28, left: 48 };
let width = $state(0);
let hover = $state<number | null>(null);

const color = (i: number) => `var(--series-${(i % 8) + 1})`;

const dateFormat = new Intl.DateTimeFormat(undefined, {
	timeZone: 'UTC',
	weekday: 'short',
	month: 'short',
	day: 'numeric'
});
const tickFormat = new Intl.DateTimeFormat(undefined, {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

/** A round axis maximum with four even steps. */
function niceMax(max: number): number {
	if (max <= 4) return 4;
	const raw = max / 4;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
	return step * 4;
}

const totals = $derived(
	buckets.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.data[i] ?? 0), 0))
);
const yMax = $derived(niceMax(Math.max(0, ...totals)));
const plotWidth = $derived(Math.max(0, width - pad.left - pad.right));
const plotHeight = $derived(height - pad.top - pad.bottom);
const slot = $derived(buckets.length ? plotWidth / buckets.length : 0);
const barWidth = $derived(Math.max(1, Math.min(32, slot * 0.7)));
const x = (i: number) => pad.left + slot * i + (slot - barWidth) / 2;
const y = (v: number) => pad.top + plotHeight - (v / yMax) * plotHeight;

/** Each bucket's segments, bottom up in series order. */
const bars = $derived(
	buckets.map((_, i) => {
		let base = 0;
		return series.map((s, j) => {
			const value = Math.max(0, s.data[i] ?? 0);
			const segment = { j, top: y(base + value), height: y(base) - y(base + value) };
			base += value;
			return segment;
		});
	})
);
const gridlines = $derived([0, 1, 2, 3, 4].map((step) => (yMax / 4) * step));
const ticks = $derived.by(() => {
	const count = Math.min(buckets.length, Math.max(2, Math.floor(plotWidth / 90)));
	if (count < 2) return buckets.map((_, i) => i);
	return Array.from({ length: count }, (_, i) =>
		Math.round((i / (count - 1)) * (buckets.length - 1))
	);
});

function onpointermove(event: PointerEvent) {
	const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
	const i = Math.floor((event.clientX - rect.left - pad.left) / Math.max(1, slot));
	hover = Math.min(buckets.length - 1, Math.max(0, i));
}

/** Tooltip rows, largest value first, leaving out series without events that day. */
const hoverRows = $derived(
	hover === null
		? []
		: series
				.map((s, i) => ({ s, i, value: s.data[hover ?? 0] ?? 0 }))
				.filter((row) => row.value > 0)
				.sort((a, b) => b.value - a.value)
);
</script>

{#if series.length > 1}
	<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
		{#each series as s, i (s.key)}
			<li class="flex items-center gap-1.5">
				<span class="size-2 rounded-sm" style:background={color(i)}></span>
				{s.label}
			</li>
		{/each}
	</ul>
{/if}

<div class="relative" bind:clientWidth={width} style:height="{height}px">
	{#if width > 0 && buckets.length}
		<svg
			{width}
			{height}
			role="img"
			aria-label="{series.map((s) => s.label).join(', ')} per day"
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
					{format(value)}
				</text>
			{/each}
			{#each ticks as i (i)}
				<text
					x={x(i) + barWidth / 2}
					y={height - 8}
					text-anchor={i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}
					class="fill-muted-foreground text-[11px]"
				>
					{tickFormat.format(new Date(buckets[i]))}
				</text>
			{/each}
			{#if hover !== null}
				<rect
					x={pad.left + slot * hover}
					y={pad.top}
					width={slot}
					height={plotHeight}
					class="fill-muted"
					opacity="0.6"
				/>
			{/if}
			{#each bars as segments, i (buckets[i])}
				{#each segments as segment (segment.j)}
					{#if segment.height > 0}
						<rect
							x={x(i)}
							y={segment.top}
							width={barWidth}
							height={segment.height}
							style:fill={color(segment.j)}
						/>
					{/if}
				{/each}
			{/each}
		</svg>
		{#if hover !== null}
			{@const center = x(hover) + barWidth / 2}
			<div
				class="pointer-events-none absolute top-0 z-10 max-w-72 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur transition-[left,transform] duration-100 ease-out"
				style:left="{center}px"
				style:transform="translateX({center > width / 2 ? 'calc(-100% - 12px)' : '12px'})"
			>
				<div class="flex gap-3 text-muted-foreground">
					{dateFormat.format(new Date(buckets[hover]))}
					UTC
					<span class="ml-auto font-medium text-popover-foreground tabular-nums"
						>{format(totals[hover])}</span
					>
				</div>
				{#each hoverRows as row (row.s.key)}
					<div class="mt-1 flex items-center gap-2">
						<span class="size-2 shrink-0 rounded-sm" style:background={color(row.i)}></span>
						<span class="truncate">{row.s.label}</span>
						<span class="ml-auto pl-3 font-medium tabular-nums">{format(row.value)}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Tables ignore sr-only sizing, so the wrapper carries it. -->
<div class="sr-only">
	<table>
		<caption>
			Values by day, UTC
		</caption>
		<thead>
			<tr>
				<th>Day</th>
				{#each series as s (s.key)}
					<th>{s.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each buckets as t, i (t)}
				<tr>
					<td>{dateFormat.format(new Date(t))}</td>
					{#each series as s (s.key)}
						<td>{s.data[i] ?? 0}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
