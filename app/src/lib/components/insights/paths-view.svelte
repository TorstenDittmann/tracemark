<script lang="ts">
/**
 * Paths as a flow: one column per step, nodes sized by sessions, bands for the transitions
 * between steps. Hovering a node brings out the bands through it. Below, the top transitions per
 * step as a table.
 */
import type { PathLink, PathNode, PathsResult } from '#lib/insights.js';

let {
	result,
	countBack = false,
	compact = false
}: {
	result: PathsResult;
	/** The paths count back from an end, so a node's `ended` is where paths started. */
	countBack?: boolean;
	compact?: boolean;
} = $props();

const height = $derived(compact ? 240 : 380);
const nodeWidth = 10;
const gap = 10;
const minColumn = 168;
let width = $state(0);
let hover = $state<{ step: number; label: string | null } | null>(null);

const name = (label: string | null) => (label === null ? 'Other' : label);
const percent = (part: number, whole: number) =>
	whole === 0 ? '0%' : `${Math.round((part / whole) * 1000) / 10}%`;

const steps = $derived(result.steps);
const column = $derived(Math.max(minColumn, steps.length ? width / steps.length : minColumn));
const chartWidth = $derived(Math.max(width, column * steps.length));
const stepTotal = (nodes: PathNode[]) => nodes.reduce((sum, node) => sum + node.sessions, 0);
const totals = $derived(steps.map((step) => stepTotal(step.nodes)));
/** Pixels per session, so the busiest step fits the height. */
const scale = $derived(
	Math.min(
		...steps.map(
			(step, i) => Math.max(0, height - (step.nodes.length - 1) * gap) / (totals[i] || 1)
		)
	)
);

interface Placed {
	node: PathNode;
	x: number;
	y: number;
	h: number;
	/** Running offsets for bands leaving and entering the node. */
	out: number;
	in: number;
}

interface Band {
	link: PathLink;
	step: number;
	from: Placed;
	to: Placed;
	/** Thickness, and the band's middle where it leaves and enters. */
	t: number;
	y0: number;
	y1: number;
}

const layout = $derived.by(() => {
	const placed = steps.map((step, i) => {
		let y = 0;
		return step.nodes.map((node): Placed => {
			const h = Math.max(2, node.sessions * scale);
			const p = { node, x: i * column, y, h, out: 0, in: 0 };
			y += h + gap;
			return p;
		});
	});
	const index = (i: number, label: string | null) =>
		placed[i]?.findIndex((p) => p.node.label === label) ?? -1;
	const bands: Band[] = [];
	steps.forEach((step, i) => {
		// Bands leave a node in the order of their targets, so they cross as little as possible.
		const links = [...step.links].sort((a, b) => index(i + 1, a.target) - index(i + 1, b.target));
		for (const link of links) {
			const from = placed[i][index(i, link.source)];
			const to = placed[i + 1]?.[index(i + 1, link.target)];
			if (!from || !to) continue;
			const t = Math.max(1, link.sessions * scale);
			bands.push({ link, step: i, from, to, t, y0: from.y + from.out + t / 2, y1: 0 });
			from.out += t;
		}
	});
	// They enter in the order of their sources.
	for (const band of [...bands].sort((a, b) => a.step - b.step || a.from.y - b.from.y)) {
		band.y1 = band.to.y + band.to.in + band.t / 2;
		band.to.in += band.t;
	}
	return { placed, bands };
});

/** Hovering a node (its bar or label) brings out its bands; anywhere else brings back all. */
function onpointerover(event: PointerEvent) {
	const target = (event.target as Element).closest<SVGGElement>('[data-node]');
	const step = Number(target?.dataset.step);
	const node = result.steps[step]?.nodes[Number(target?.dataset.node)];
	hover = target && node ? { step, label: node.label } : null;
}

const curve = (x0: number, y0: number, x1: number, y1: number) => {
	const mid = (x0 + x1) / 2;
	return `M${x0},${y0}C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
};

const active = (step: number, label: string | null) =>
	hover !== null && hover.step === step && hover.label === label;
const touches = (band: Band) =>
	hover === null || active(band.step, band.link.source) || active(band.step + 1, band.link.target);

const maxChars = $derived(Math.max(6, Math.floor((column - nodeWidth - 16) / 7)));
const short = (text: string) => (text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text);
const endedLabel = $derived(countBack ? 'started here' : 'dropped off');
</script>

{#if !result.sessions}
	<p class="py-12 text-center text-sm text-muted-foreground">No sessions match these paths.</p>
{:else}
	<div class="grid gap-5">
		<div class="relative overflow-x-auto" bind:clientWidth={width}>
			<div
				class="grid text-xs text-muted-foreground"
				style:width="{chartWidth}px"
				style:grid-template-columns="repeat({steps.length}, {column}px)"
			>
				{#each steps as step, i (i)}
					{@const ended = step.nodes.reduce((sum, node) => sum + node.ended, 0)}
					<div class="min-w-0 pr-3 pb-2 [&>div]:truncate">
						<div class="font-medium text-foreground">Step {i + 1}</div>
						<div class="tabular-nums">{totals[i].toLocaleString()} sessions</div>
						<div class="tabular-nums">
							{ended ? `${percent(ended, totals[i])} ${endedLabel}` : '\u00a0'}
						</div>
					</div>
				{/each}
			</div>
			{#if width > 0}
				<svg
					width={chartWidth}
					{height}
					role="img"
					aria-label="Paths over {steps.length} steps"
					class="block select-none"
					{onpointerover}
					onpointerleave={() => (hover = null)}
				>
					<g fill="none">
						{#each layout.bands as band (`${band.step}:${band.link.source}:${band.link.target}`)}
							<path
								d={curve(band.from.x + nodeWidth, band.y0, band.to.x, band.y1)}
								stroke-width={band.t}
								class="stroke-series-1 transition-opacity"
								stroke-opacity={touches(band) ? (hover ? 0.5 : 0.25) : 0.06}
							>
								<title>
									{name(band.link.source)}
									→ {name(band.link.target)}: {band.link.sessions.toLocaleString()} sessions
								</title>
							</path>
						{/each}
					</g>
					{#each layout.placed as nodes, i (i)}
						{#each nodes as p (p.node.label)}
							<g data-step={i} data-node={nodes.indexOf(p)}>
								<rect
									x={p.x}
									y={p.y}
									width={nodeWidth}
									height={p.h}
									rx="2"
									class={p.node.label === null ? 'fill-muted-foreground' : 'fill-series-1'}
								>
									<title>
										{name(p.node.label)}: {p.node.sessions.toLocaleString()} sessions,
										{p.node.ended.toLocaleString()}
										{endedLabel}
									</title>
								</rect>
								<text
									x={p.x + nodeWidth + 6}
									y={p.y + p.h / 2}
									dy="0.32em"
									class="label fill-foreground text-[11px]"
								>
									<tspan class={p.node.label === null ? 'fill-muted-foreground' : ''}>
										{short(name(p.node.label))}
									</tspan>
									<tspan class="fill-muted-foreground tabular-nums">
										{p.node.sessions.toLocaleString()}
									</tspan>
								</text>
							</g>
						{/each}
					{/each}
				</svg>
			{/if}
		</div>

		{#if !compact}
			<div class="relative overflow-x-auto">
				<table class="data-table w-full text-sm">
					<thead class="text-left text-xs text-muted-foreground">
						<tr>
							<th class="py-2 pr-4 font-normal">Step</th>
							<th class="px-4 py-2 font-normal">From</th>
							<th class="px-4 py-2 font-normal">To</th>
							<th class="px-4 py-2 text-right font-normal">Sessions</th>
							<th class="py-2 pl-4 text-right font-normal">Of from</th>
						</tr>
					</thead>
					<tbody>
						{#each steps as step, i (i)}
							{#each step.links.slice(0, 5) as link (`${link.source}:${link.target}`)}
								{@const from = step.nodes.find((node) => node.label === link.source)}
								<tr class="border-t">
									<td class="py-2 pr-4 text-muted-foreground tabular-nums">{i + 1} → {i + 2}</td>
									<td class="max-w-64 truncate px-4 py-2" title={name(link.source)}>
										{name(link.source)}
									</td>
									<td class="max-w-64 truncate px-4 py-2" title={name(link.target)}>
										{name(link.target)}
									</td>
									<td class="px-4 py-2 text-right tabular-nums">
										{link.sessions.toLocaleString()}
									</td>
									<td class="py-2 pl-4 text-right tabular-nums">
										{percent(link.sessions, from?.sessions ?? 0)}
									</td>
								</tr>
							{/each}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}

<style>
.label {
	paint-order: stroke;
	stroke: var(--card);
	stroke-width: 3px;
	stroke-linejoin: round;
}
</style>
