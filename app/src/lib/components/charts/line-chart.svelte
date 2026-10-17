<script lang="ts" module>
export interface ChartLine {
	key: string;
	label: string;
	/** One value per bucket. */
	data: number[];
}
</script>

<script lang="ts">
/**
 * Lines over time on one axis, with a crosshair tooltip and a screen-reader table. Colors follow
 * the categorical palette in line order; a single line also gets an area wash. Buckets are UTC.
 */
let {
	lines,
	buckets,
	bucket,
	height = 240,
	format = (value: number) => value.toLocaleString()
}: {
	lines: ChartLine[];
	buckets: string[];
	bucket: 'hour' | 'day';
	height?: number;
	format?: (value: number) => string;
} = $props();

const pad = { top: 12, right: 12, bottom: 28, left: 48 };
let width = $state(0);
let hover = $state<number | null>(null);

const color = (i: number) => `var(--series-${(i % 8) + 1})`;

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
	// Counts get whole-number steps; small fractions such as costs get their own scale.
	if (max <= 0 || (max <= 4 && Number.isInteger(max))) return 4;
	const raw = max / 4;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
	return step * 4;
}

const yMax = $derived(niceMax(Math.max(0, ...lines.flatMap((line) => line.data))));
const plotWidth = $derived(Math.max(0, width - pad.left - pad.right));
const plotHeight = $derived(height - pad.top - pad.bottom);
const x = (i: number) =>
	pad.left + (buckets.length > 1 ? (i / (buckets.length - 1)) * plotWidth : plotWidth / 2);
const y = (v: number) => pad.top + plotHeight - (Math.max(0, v) / yMax) * plotHeight;

/** A smooth path through the points that never overshoots them (monotone cubic). */
function smooth(points: [number, number][]): string {
	if (points.length < 3) return points.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join('');
	const n = points.length;
	const slopes = points
		.slice(1)
		.map(([px, py], i) => (py - points[i][1]) / (px - points[i][0] || 1));
	const tangents = points.map((_, i) => {
		if (i === 0) return slopes[0];
		if (i === n - 1) return slopes[n - 2];
		const a = slopes[i - 1];
		const b = slopes[i];
		return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
	});
	let d = `M${points[0][0]},${points[0][1]}`;
	for (let i = 0; i < n - 1; i++) {
		const [x0, y0] = points[i];
		const [x1, y1] = points[i + 1];
		const h = (x1 - x0) / 3;
		d += `C${x0 + h},${y0 + h * tangents[i]} ${x1 - h},${y1 - h * tangents[i + 1]} ${x1},${y1}`;
	}
	return d;
}

const paths = $derived(
	lines.map((line) => smooth(line.data.map((v, i) => [x(i), y(v)] as [number, number])))
);
const gradientId = $props.id();
const area = $derived(
	lines.length === 1 && buckets.length
		? `${paths[0]}L${x(buckets.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
		: ''
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
	const ratio = (event.clientX - rect.left - pad.left) / Math.max(1, plotWidth);
	hover = Math.min(buckets.length - 1, Math.max(0, Math.round(ratio * (buckets.length - 1))));
}

/** Tooltip rows, largest value first. */
const hoverRows = $derived(
	hover === null
		? []
		: lines
				.map((line, i) => ({ line, i, value: line.data[hover ?? 0] ?? 0 }))
				.sort((a, b) => b.value - a.value)
);
</script>

{#if lines.length > 1}
	<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
		{#each lines as line, i (line.key)}
			<li class="flex items-center gap-1.5">
				<span class="h-0.5 w-3 rounded-full" style:background={color(i)}></span>
				{line.label}
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
			aria-label="{lines.map((line) => line.label).join(', ')} over time"
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
					x={x(i)}
					y={height - 8}
					text-anchor={i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}
					class="fill-muted-foreground text-[11px]"
				>
					{tickFormat.format(new Date(buckets[i]))}
				</text>
			{/each}
			<defs>
				<linearGradient id="area-{gradientId}" x1="0" x2="0" y1="0" y2="1">
					<stop offset="0" style:stop-color={color(0)} stop-opacity="0.22" />
					<stop offset="1" style:stop-color={color(0)} stop-opacity="0" />
				</linearGradient>
			</defs>
			<g>
				{#if area}
					<path d={area} fill="url(#area-{gradientId})" />
				{/if}
				{#each paths as d, i (lines[i].key)}
					<path
						{d}
						fill="none"
						style:stroke={color(i)}
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
				{/each}
			</g>
			{#if hover !== null}
				<line
					x1={x(hover)}
					x2={x(hover)}
					y1={pad.top}
					y2={y(0)}
					class="stroke-muted-foreground"
					stroke-width="1"
					stroke-dasharray="3 3"
				/>
				{#each lines as line, i (line.key)}
					<circle
						cx={x(hover)}
						cy={y(line.data[hover] ?? 0)}
						r="4.5"
						style:fill={color(i)}
						class="dot stroke-card"
						stroke-width="2"
					/>
				{/each}
			{/if}
		</svg>
		{#if hover !== null}
			<div
				class="pointer-events-none absolute top-0 z-10 max-w-72 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur transition-[left,transform] duration-100 ease-out"
				style:left="{x(hover)}px"
				style:transform="translateX({x(hover) > width / 2 ? 'calc(-100% - 12px)' : '12px'})"
			>
				<div class="text-muted-foreground">{dateFormat.format(new Date(buckets[hover]))} UTC</div>
				{#each hoverRows as row (row.line.key)}
					<div class="mt-1 flex items-center gap-2">
						<span class="size-2 shrink-0 rounded-full" style:background={color(row.i)}></span>
						<span class="truncate">{row.line.label}</span>
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
			Values by {bucket}, UTC
		</caption>
		<thead>
			<tr>
				<th>Time</th>
				{#each lines as line (line.key)}
					<th>{line.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each buckets as t, i (t)}
				<tr>
					<td>{dateFormat.format(new Date(t))}</td>
					{#each lines as line (line.key)}
						<td>{line.data[i]}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
.dot {
	transition:
		cx 100ms ease-out,
		cy 100ms ease-out;
}
</style>
