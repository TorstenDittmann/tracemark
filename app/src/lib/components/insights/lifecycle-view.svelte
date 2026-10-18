<script lang="ts" module>
import type { LifecycleStatus } from '#lib/insights.js';

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
	new: 'New',
	returning: 'Returning',
	resurrecting: 'Resurrecting',
	dormant: 'Dormant'
};
</script>

<script lang="ts">
/**
 * People by lifecycle state per period, as bars stacked up from zero (new, returning,
 * resurrecting) with dormant below it. Hovering a period shows its counts; a screen-reader
 * table carries the same numbers.
 */
import { LIFECYCLE_STATUSES, type LifecycleResult } from '#lib/insights.js';

let {
	result,
	event,
	compact = false
}: { result: LifecycleResult; event: string; compact?: boolean } = $props();

const height = $derived(compact ? 200 : 280);
const pad = { top: 12, right: 12, bottom: 28, left: 48 };
let width = $state(0);
let hover = $state<number | null>(null);

const color = (status: LifecycleStatus) =>
	`var(--series-${LIFECYCLE_STATUSES.indexOf(status) + 1})`;
const positive = LIFECYCLE_STATUSES.filter((status) => status !== 'dormant');

const periods = $derived(result.periods);
const up = $derived(
	periods.map((_, i) => positive.reduce((sum, status) => sum + result.counts[status][i], 0))
);
const down = $derived(periods.map((_, i) => -result.counts.dormant[i]));
const anyone = $derived(up.some((v) => v > 0) || down.some((v) => v > 0));

/** A round step for about four gridlines across the larger side. */
function niceStep(max: number): number {
	if (max <= 4) return 1;
	const raw = max / 4;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
}

const step = $derived(niceStep(Math.max(1, ...up, ...down)));
const top = $derived(Math.max(step, Math.ceil(Math.max(0, ...up) / step) * step));
const bottom = $derived(Math.ceil(Math.max(0, ...down) / step) * step);
const plotWidth = $derived(Math.max(0, width - pad.left - pad.right));
const plotHeight = $derived(height - pad.top - pad.bottom);
const y = (v: number) => pad.top + ((top - v) / (top + bottom)) * plotHeight;
const band = $derived(periods.length ? plotWidth / periods.length : 0);
const barWidth = $derived(Math.max(2, Math.min(40, band * 0.7)));
const x = (i: number) => pad.left + band * i + band / 2;
const gridlines = $derived(
	Array.from({ length: Math.round((top + bottom) / step) + 1 }, (_, i) => top - i * step)
);

/** The whole band of a period is its hover target, wider than the bar. */
function onpointermove(event: PointerEvent) {
	const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
	const i = Math.floor((event.clientX - rect.left - pad.left) / Math.max(1, band));
	hover = i >= 0 && i < periods.length ? i : null;
}

/** Stacked segments of one period, with a 2px gap between them. */
function segments(i: number) {
	const out: { status: LifecycleStatus; y: number; h: number }[] = [];
	let base = 0;
	for (const status of positive) {
		const v = result.counts[status][i];
		if (v > 0) {
			out.push({ status, y: y(base + v), h: Math.max(1, y(base) - y(base + v) - (base ? 2 : 0)) });
			base += v;
		}
	}
	if (down[i] > 0) out.push({ status: 'dormant', y: y(0), h: Math.max(1, y(-down[i]) - y(0)) });
	return out;
}

const dateFormat = $derived(
	new Intl.DateTimeFormat(undefined, {
		timeZone: 'UTC',
		...(result.interval === 'month'
			? { month: 'long', year: 'numeric' }
			: {
					weekday: result.interval === 'day' ? 'short' : undefined,
					month: 'short',
					day: 'numeric'
				})
	})
);
const tickFormat = $derived(
	new Intl.DateTimeFormat(undefined, {
		timeZone: 'UTC',
		...(result.interval === 'month' ? { month: 'short' } : { month: 'short', day: 'numeric' })
	})
);
const periodLabel = (start: string) =>
	`${result.interval === 'week' ? 'Week of ' : ''}${dateFormat.format(new Date(start))}`;
const ticks = $derived.by(() => {
	const count = Math.min(periods.length, Math.max(2, Math.floor(plotWidth / 80)));
	if (count < 2 || periods.length < 2) return periods.map((_, i) => i);
	const every = Math.ceil(periods.length / count);
	return periods.map((_, i) => i).filter((i) => i % every === 0);
});
const totals = $derived(
	Object.fromEntries(
		LIFECYCLE_STATUSES.map((status) => [
			status,
			result.counts[status].reduce((sum, v) => sum + Math.abs(v), 0)
		])
	) as Record<LifecycleStatus, number>
);
</script>

{#if !anyone}
	<p class="py-12 text-center text-sm text-muted-foreground">Nobody did {event} in this range.</p>
{:else}
	<ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
		{#each LIFECYCLE_STATUSES as status (status)}
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm" style:background={color(status)}></span>
				{LIFECYCLE_LABELS[status]}
				{#if !compact}
					<span class="tabular-nums">· {totals[status].toLocaleString()}</span>
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
				aria-label="People by lifecycle state per {result.interval}"
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
						class="fill-muted-foreground text-[11px]"
					>
						{tickFormat.format(new Date(periods[i]))}
					</text>
				{/each}
				{#each periods as start, i (start)}
					<g opacity={hover === null || hover === i ? 1 : 0.55}>
						{#each segments(i) as segment (segment.status)}
							<rect
								x={x(i) - barWidth / 2}
								y={segment.y}
								width={barWidth}
								height={segment.h}
								rx="2"
								style:fill={color(segment.status)}
							/>
						{/each}
					</g>
				{/each}
			</svg>
			{#if hover !== null}
				<div
					class="pointer-events-none absolute top-0 z-10 w-48 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur"
					style:left="{x(hover)}px"
					style:transform="translateX({x(hover) > width / 2 ? 'calc(-100% - 16px)' : '16px'})"
				>
					<div class="text-muted-foreground">{periodLabel(periods[hover])} UTC</div>
					{#each LIFECYCLE_STATUSES as status (status)}
						<div class="mt-1 flex items-center gap-2">
							<span class="size-2 shrink-0 rounded-sm" style:background={color(status)}></span>
							<span>{LIFECYCLE_LABELS[status]}</span>
							<span class="ml-auto pl-3 font-medium tabular-nums">
								{result.counts[status][hover].toLocaleString()}
							</span>
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
				People by lifecycle state per {result.interval}, UTC
			</caption>
			<thead>
				<tr>
					<th>Period</th>
					{#each LIFECYCLE_STATUSES as status (status)}
						<th>{LIFECYCLE_LABELS[status]}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each periods as start, i (start)}
					<tr>
						<td>{periodLabel(start)}</td>
						{#each LIFECYCLE_STATUSES as status (status)}
							<td>{result.counts[status][i]}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
