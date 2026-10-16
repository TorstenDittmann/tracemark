<script lang="ts">
/** A single-series area chart over time with a crosshair tooltip. Buckets are labelled in UTC. */
interface Point {
	t: string;
	value: number;
}

let {
	points,
	label,
	bucket,
	height = 220
}: { points: Point[]; label: string; bucket: 'hour' | 'day'; height?: number } = $props();

const pad = { top: 12, right: 12, bottom: 28, left: 44 };
let width = $state(0);
let hover = $state<number | null>(null);

const dateFormat = $derived(
	new Intl.DateTimeFormat(undefined, {
		timeZone: 'UTC',
		...(bucket === 'hour'
			? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
			: { weekday: 'short', month: 'short', day: 'numeric' })
	})
);
const tickFormat = $derived(
	new Intl.DateTimeFormat(undefined, {
		timeZone: 'UTC',
		...(bucket === 'hour' ? { hour: 'numeric' } : { month: 'short', day: 'numeric' })
	})
);

/** A round axis maximum with four even steps. */
function niceMax(max: number): number {
	if (max <= 4) return 4;
	const raw = max / 4;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
	return step * 4;
}

const yMax = $derived(niceMax(Math.max(0, ...points.map((p) => p.value))));
const plotWidth = $derived(Math.max(0, width - pad.left - pad.right));
const plotHeight = $derived(height - pad.top - pad.bottom);
const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : 0);
const y = (v: number) => pad.top + plotHeight - (v / yMax) * plotHeight;

const line = $derived(points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(''));
const area = $derived(
	points.length ? `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : ''
);
const gridlines = $derived([0, 1, 2, 3, 4].map((step) => (yMax / 4) * step));
const ticks = $derived.by(() => {
	const count = Math.min(points.length, Math.max(2, Math.floor(plotWidth / 90)));
	if (count < 2) return points.map((_, i) => i);
	return Array.from({ length: count }, (_, i) =>
		Math.round((i / (count - 1)) * (points.length - 1))
	);
});

function onpointermove(event: PointerEvent) {
	const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
	const ratio = (event.clientX - rect.left - pad.left) / Math.max(1, plotWidth);
	hover = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
}

const hovered = $derived(hover === null ? null : points[hover]);
</script>

<div class="relative" bind:clientWidth={width} style:height="{height}px">
	{#if width > 0}
		<svg
			{width}
			{height}
			role="img"
			aria-label="{label} over time"
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
					text-anchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
					class="fill-muted-foreground text-[11px]"
				>
					{tickFormat.format(new Date(points[i].t))}
				</text>
			{/each}
			<path d={area} class="fill-series-1" fill-opacity="0.1" />
			<path
				d={line}
				fill="none"
				class="stroke-series-1"
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
			{#if hover !== null && hovered}
				<line
					x1={x(hover)}
					x2={x(hover)}
					y1={pad.top}
					y2={y(0)}
					class="stroke-muted-foreground"
					stroke-width="1"
					stroke-dasharray="3 3"
				/>
				<circle
					cx={x(hover)}
					cy={y(hovered.value)}
					r="4"
					class="fill-series-1 stroke-card"
					stroke-width="2"
				/>
			{/if}
		</svg>
		{#if hover !== null && hovered}
			<div
				class="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
				style:left="{x(hover)}px"
				style:transform="translateX({x(hover) > width / 2 ? 'calc(-100% - 12px)' : '12px'})"
			>
				<div class="text-muted-foreground">{dateFormat.format(new Date(hovered.t))} UTC</div>
				<div class="mt-1 flex items-center gap-2 whitespace-nowrap">
					<span class="size-2 rounded-full bg-series-1"></span>
					<span>{label}</span>
					<span class="ml-auto pl-3 font-medium tabular-nums"
						>{hovered.value.toLocaleString()}</span
					>
				</div>
			</div>
		{/if}
	{/if}
</div>

<table class="sr-only">
	<caption>
		{label}
		by {bucket}, UTC
	</caption>
	<thead>
		<tr>
			<th>Time</th>
			<th>{label}</th>
		</tr>
	</thead>
	<tbody>
		{#each points as point (point.t)}
			<tr>
				<td>{dateFormat.format(new Date(point.t))}</td>
				<td>{point.value}</td>
			</tr>
		{/each}
	</tbody>
</table>
