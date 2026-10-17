<script lang="ts">
import Bug from '@lucide/svelte/icons/bug';
import ChartSpline from '@lucide/svelte/icons/chart-spline';
import Sparkles from '@lucide/svelte/icons/sparkles';
import ToggleRight from '@lucide/svelte/icons/toggle-right';
import Logo from '#lib/components/logo.svelte';
import ThemeToggle from '#lib/components/shell/theme-toggle.svelte';
import * as Tooltip from '#lib/components/ui/tooltip/index.js';
import type { LayoutProps } from './$types';

let { children }: LayoutProps = $props();

const features = [
	{ icon: ChartSpline, title: 'Product and web analytics', text: 'Trends, funnels and retention.' },
	{ icon: ToggleRight, title: 'Flags and experiments', text: 'Ship gradually, measure what wins.' },
	{ icon: Bug, title: 'Error tracking', text: 'Issues with readable stack traces.' },
	{ icon: Sparkles, title: 'AI observability', text: 'Costs, latency and traces per call.' }
];

// A decorative trend line for the showcase panel.
const points = [12, 18, 15, 24, 22, 31, 28, 38, 35, 46, 44, 58];
const path = points
	.map((v, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 300},${100 - v * 1.5}`)
	.join('');
</script>

<Tooltip.Provider>
	<div class="grid min-h-svh lg:grid-cols-[1fr_minmax(0,560px)]">
		<div class="flex flex-col px-6 py-6 sm:px-10">
			<div class="flex items-center justify-between">
				<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
					<Logo class="size-7" />
					Tracemark
				</a>
				<ThemeToggle />
			</div>
			<main class="flex flex-1 items-center justify-center py-10">
				<div class="w-full max-w-sm">{@render children()}</div>
			</main>
			<p class="text-center text-xs text-muted-foreground">
				Self-hosted, open source analytics. Your data stays on your servers.
			</p>
		</div>
		<aside
			class="relative hidden overflow-hidden border-l bg-gradient-to-br from-primary/90 via-primary to-[#3b2fb8] p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between"
		>
			<div
				class="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
			></div>
			<div class="relative">
				<p class="text-3xl leading-tight font-semibold tracking-tight text-balance">
					Everything you need to understand your product. Nothing you don't.
				</p>
			</div>
			<div
				class="relative rounded-2xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-md"
			>
				<div class="flex items-baseline justify-between">
					<div>
						<p class="text-xs text-white/70">Weekly active users</p>
						<p class="text-2xl font-semibold tabular-nums">12,480</p>
					</div>
					<span
						class="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-medium text-emerald-100"
					>
						+18.2%
					</span>
				</div>
				<svg viewBox="0 0 300 100" class="mt-4 h-28 w-full overflow-visible" aria-hidden="true">
					<defs>
						<linearGradient id="showcase-fill" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0" stop-color="white" stop-opacity="0.35" />
							<stop offset="1" stop-color="white" stop-opacity="0" />
						</linearGradient>
					</defs>
					<path d="{path}L300,100L0,100Z" fill="url(#showcase-fill)" />
					<path
						d={path}
						fill="none"
						stroke="white"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						pathLength="1"
						class="[stroke-dasharray:1] [animation:draw_0.8s_ease-out_both]"
					/>
				</svg>
			</div>
			<ul class="relative grid grid-cols-2 gap-4">
				{#each features as feature (feature.title)}
					<li class="flex gap-3">
						<span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
							<feature.icon class="size-4" />
						</span>
						<span class="grid text-sm">
							<span class="font-medium">{feature.title}</span>
							<span class="text-white/70">{feature.text}</span>
						</span>
					</li>
				{/each}
			</ul>
		</aside>
	</div>
</Tooltip.Provider>

<style>
@keyframes -global-draw {
	from {
		stroke-dashoffset: 1;
	}
	to {
		stroke-dashoffset: 0;
	}
}
</style>
