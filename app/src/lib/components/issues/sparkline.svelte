<script lang="ts">
/** Occurrences per bucket as small bars; each bar names its bucket and count on hover. */
let {
	data,
	buckets,
	bucket,
	width = 120,
	height = 28
}: {
	data: number[];
	buckets: string[];
	bucket: 'hour' | 'day';
	width?: number;
	height?: number;
} = $props();

const format = $derived(
	new Intl.DateTimeFormat(undefined, {
		timeZone: 'UTC',
		...(bucket === 'hour'
			? { month: 'short', day: 'numeric', hour: 'numeric' }
			: { month: 'short', day: 'numeric' })
	})
);
const max = $derived(Math.max(1, ...data));
const step = $derived(data.length ? width / data.length : width);
const gap = $derived(step > 4 ? 1 : 0);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" class="block" aria-hidden="true">
	<line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} class="stroke-border" />
	{#each data as value, i (i)}
		{@const h = value ? Math.max(2, (value / max) * (height - 2)) : 0}
		<rect x={i * step} y={0} width={Math.max(1, step - gap)} {height} fill="transparent">
			<title>{format.format(new Date(buckets[i] ?? ''))}: {value.toLocaleString()}</title>
		</rect>
		{#if h}
			<rect
				x={i * step}
				y={height - h}
				width={Math.max(1, step - gap)}
				height={h}
				rx="1"
				fill="var(--series-1)"
				pointer-events="none"
			/>
		{/if}
	{/each}
</svg>
