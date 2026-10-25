<script lang="ts">
import type { Heatmap } from '#lib/heatmaps.js';

let { heatmap }: { heatmap: Heatmap } = $props();

/** Canvas pixels per grid cell; the canvas is stretched over the page. */
const CELL = 6;
/** One warm hue from light to dark: few clicks are pale and see-through, many deep red. */
const LOW = [253, 186, 116];
const HIGH = [220, 38, 38];

let hover = $state<{ x: number; y: number; clicks: number } | null>(null);

const counts = $derived(new Map(heatmap.cells.map(([x, y, c]) => [`${x},${y}`, c])));
const max = $derived(Math.max(1, ...heatmap.cells.map(([, , c]) => c)));

/** Draws the heatmap, again whenever it changes. */
function paint(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const width = heatmap.columns * CELL;
	const height = heatmap.rows * CELL;
	canvas.width = width;
	canvas.height = height;
	ctx.clearRect(0, 0, width, height);
	// Density first, as overlapping translucent blobs in alpha only...
	const radius = CELL * 3;
	for (const [x, y, c] of heatmap.cells) {
		const cx = (x + 0.5) * CELL;
		const cy = (y + 0.5) * CELL;
		const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
		g.addColorStop(0, `rgba(0,0,0,${0.15 + 0.6 * Math.sqrt(c / max)})`);
		g.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = g;
		ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
	}
	// ...then each pixel's alpha is mapped onto the color ramp.
	const image = ctx.getImageData(0, 0, width, height);
	const px = image.data;
	for (let i = 0; i < px.length; i += 4) {
		const a = px[i + 3] ?? 0;
		if (!a) continue;
		const t = a / 255;
		for (let k = 0; k < 3; k++) px[i + k] = (LOW[k] ?? 0) + ((HIGH[k] ?? 0) - (LOW[k] ?? 0)) * t;
		px[i + 3] = Math.round(255 * (0.2 + 0.6 * t));
	}
	ctx.putImageData(image, 0, 0);
}

function move(event: PointerEvent) {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const fx = (event.clientX - rect.left) / rect.width;
	const fy = (event.clientY - rect.top) / rect.height;
	const col = Math.min(heatmap.columns - 1, Math.max(0, Math.floor(fx * heatmap.columns)));
	const row = Math.min(heatmap.rows - 1, Math.max(0, Math.floor(fy * heatmap.rows)));
	// The 3x3 cells around the pointer, so a near miss still reads.
	let clicks = 0;
	for (let dx = -1; dx <= 1; dx++)
		for (let dy = -1; dy <= 1; dy++) clicks += counts.get(`${col + dx},${row + dy}`) ?? 0;
	hover = clicks ? { x: event.clientX - rect.left, y: event.clientY - rect.top, clicks } : null;
}
</script>

<div
	class="absolute inset-0"
	role="img"
	aria-label="Click heatmap: {heatmap.clicks.toLocaleString()} clicks"
	onpointermove={move}
	onpointerleave={() => (hover = null)}
>
	<canvas {@attach paint} class="size-full"></canvas>
	{#if hover}
		<div
			class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
			style:left="{hover.x}px"
			style:top="{hover.y}px"
		>
			<span class="font-medium tabular-nums">{hover.clicks.toLocaleString()}</span>
			{hover.clicks === 1 ? 'click' : 'clicks'}
			here
		</div>
	{/if}
</div>
