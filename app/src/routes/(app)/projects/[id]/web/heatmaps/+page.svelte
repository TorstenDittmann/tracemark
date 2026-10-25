<script lang="ts">
import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
import EmptyState from '#lib/components/empty-state.svelte';
import HeatmapOverlay from '#lib/components/heatmap-overlay.svelte';
import RangePicker from '#lib/components/range-picker.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import * as NativeSelect from '#lib/components/ui/native-select/index.js';
import { Switch } from '#lib/components/ui/switch/index.js';
import { type FramingCheck, HEATMAP_DEVICES, type HeatmapDevice } from '#lib/heatmaps.js';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const devices = Object.keys(HEATMAP_DEVICES) as HeatmapDevice[];
/** How long a page may take to load in the frame before it counts as blocked. */
const FRAME_TIMEOUT_MS = 10_000;

/** The current URL with some query parameters set (string) or removed (null). */
function href(changes: Record<string, string | null>): string {
	const url = new URL(page.url.href);
	for (const [key, value] of Object.entries(changes)) {
		if (value === null) url.searchParams.delete(key);
		else url.searchParams.set(key, value);
	}
	return `${url.pathname}${url.search}`;
}

let showPage = $state(true);
let loaded = $state(false);
let timedOut = $state(false);
let framing = $state<FramingCheck>({ status: 'unknown' });
let width = $state(0);

$effect(() => {
	const url = data.frameUrl;
	loaded = false;
	timedOut = false;
	framing = { status: 'unknown' };
	let current = true;
	data.framing.then((check) => {
		if (current) framing = check;
	});
	const timer = setTimeout(() => {
		if (url && !loaded && showPage) timedOut = true;
	}, FRAME_TIMEOUT_MS);
	return () => {
		current = false;
		clearTimeout(timer);
	};
});

const map = $derived(data.heatmap);
const blocked = $derived(framing.status === 'blocked' || timedOut);
const framed = $derived(showPage && !!data.frameUrl && !blocked);
const scale = $derived(map && width ? Math.min(1, width / map.viewportWidth) : 1);
const maxClicks = $derived(Math.max(1, ...(map?.elements.map((e) => e.clicks) ?? [])));
const pathOptions = $derived(
	data.pages.some((p) => p.path === data.path)
		? data.pages
		: [{ path: data.path, clicks: 0 }, ...data.pages]
);
const reasons = {
	'x-frame-options': 'its X-Frame-Options header does not allow other sites to frame it',
	'frame-ancestors': 'its Content-Security-Policy frame-ancestors does not list this dashboard',
	'mixed-content': 'it is served over http, and this dashboard over https'
} as const;
</script>

<svelte:head>
	<title>Heatmaps · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<div class="flex flex-wrap items-center gap-2">
		<RangePicker current={data.range} />
		<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
			<legend class="sr-only">Device</legend>
			{#each devices as device (device)}
				<a
					href={href({ device })}
					aria-current={data.device === device ? 'true' : undefined}
					title="Viewports {HEATMAP_DEVICES[device].max === null
						? `${HEATMAP_DEVICES[device].min} px and wider`
						: `${HEATMAP_DEVICES[device].min}–${HEATMAP_DEVICES[device].max} px wide`}"
					class={[
						'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
						data.device === device
							? 'bg-background text-foreground shadow-sm dark:bg-input/40'
							: 'text-muted-foreground hover:text-foreground'
					]}
				>
					{HEATMAP_DEVICES[device].label}
				</a>
			{/each}
		</fieldset>
		<div class="flex items-center gap-2 text-sm">
			<label for="heatmap-path" class="text-muted-foreground">Page</label>
			<NativeSelect.Root
				id="heatmap-path"
				size="sm"
				value={data.path}
				onchange={(e) => goto(href({ path: e.currentTarget.value, url: null }))}
				class="max-w-64"
			>
				{#each pathOptions as option (option.path)}
					<NativeSelect.Option value={option.path}>
						{option.path}{option.clicks ? ` (${option.clicks.toLocaleString()})` : ''}
					</NativeSelect.Option>
				{/each}
			</NativeSelect.Root>
		</div>
	</div>

	{#if !data.available || !map}
		<p class="text-sm text-muted-foreground">
			Heatmaps are unavailable because ClickHouse could not be reached.
		</p>
	{:else if data.pages.length === 0 && map.clicks === 0 && map.elements.length === 0}
		<Card.Root>
			<EmptyState
				icon={MousePointerClick}
				title="No clicks yet"
				description="Turn on autocaptureClicks, or heatmaps for clicks anywhere on the page, in the browser SDK. Clicks show up here as they arrive."
			>
				<Button
					href="https://github.com/TorstenDittmann/tracemark/blob/main/docs/heatmaps.md"
					variant="outline"
					size="sm"
					target="_blank"
					rel="noreferrer"
				>
					Set up heatmaps
				</Button>
			</EmptyState>
		</Card.Root>
	{:else}
		<div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<Card.Root class="gap-4">
				<Card.Header class="flex flex-row flex-wrap items-start justify-between gap-3">
					<div class="grid gap-1">
						<Card.Title>{data.path}</Card.Title>
						<Card.Description>
							{map.clicks.toLocaleString()}
							{map.clicks === 1 ? 'click' : 'clicks'}
							on {HEATMAP_DEVICES[data.device].label.toLowerCase()}
							· drawn at {map.viewportWidth} px wide
						</Card.Description>
					</div>
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Switch id="heatmap-show-page" bind:checked={showPage} disabled={!data.frameUrl} />
						<label for="heatmap-show-page">Show page</label>
					</div>
				</Card.Header>
				<Card.Content class="grid gap-3">
					<form method="GET" class="flex flex-wrap items-center gap-2">
						<input type="hidden" name="range" value={data.range}>
						<input type="hidden" name="device" value={data.device}>
						<input type="hidden" name="path" value={data.path}>
						<Input
							name="url"
							type="url"
							value={data.override ?? data.frameUrl ?? ''}
							placeholder="https://example.com{data.path}"
							aria-label="Page URL to show behind the heatmap"
							class="h-8 min-w-0 flex-1 text-sm"
						/>
						<Button type="submit" size="sm" variant="outline">Load</Button>
						{#if data.override}
							<Button href={href({ url: null })} size="sm" variant="ghost">Reset</Button>
						{/if}
					</form>

					{#if showPage && data.frameUrl && blocked}
						<div class="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
							<p class="font-medium text-foreground">The page can't be shown here</p>
							<p>
								{framing.status === 'blocked'
									? `${data.frameUrl} can't be framed: ${reasons[framing.reason]}.`
									: `${data.frameUrl} didn't load in a frame.`}
								The clicks are drawn on a blank page instead. To see the page behind them, let this
								dashboard frame your site with
								<code class="rounded bg-muted px-1 text-xs"
									>Content-Security-Policy: frame-ancestors 'self' {page.url.origin}</code
								>
								and drop <code class="rounded bg-muted px-1 text-xs">X-Frame-Options</code> (see
								docs/heatmaps.md).
							</p>
						</div>
					{:else if !data.frameUrl}
						<p class="text-sm text-muted-foreground">
							{data.override
								? 'Enter an http or https URL to show the page behind the clicks.'
								: 'No page URL is known for this project yet. Enter one above to show the page behind the clicks.'}
						</p>
					{/if}

					<div
						class="max-h-[75vh] overflow-auto rounded-md border bg-background"
						bind:clientWidth={width}
					>
						<div
							class="relative mx-auto overflow-hidden"
							style:width="{map.viewportWidth * scale}px"
							style:height="{map.documentHeight * scale}px"
						>
							<div
								class="absolute top-0 left-0 origin-top-left"
								style:width="{map.viewportWidth}px"
								style:height="{map.documentHeight}px"
								style:transform="scale({scale})"
							>
								{#if framed && data.frameUrl}
									<iframe
										src={data.frameUrl}
										name="tracemark-heatmap"
										title="{data.path} behind the heatmap"
										sandbox="allow-scripts allow-same-origin"
										referrerpolicy="no-referrer"
										tabindex="-1"
										class="pointer-events-none size-full border-0 bg-white"
										onload={() => (loaded = true)}
									></iframe>
								{:else}
									<div
										class="size-full bg-[repeating-linear-gradient(0deg,transparent_0,transparent_99px,var(--border)_99px,var(--border)_100px)]"
										aria-hidden="true"
									></div>
								{/if}
							</div>
							<HeatmapOverlay heatmap={map} />
						</div>
					</div>
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<span>Fewer clicks</span>
						<span
							class="h-2 w-24 rounded-full bg-linear-to-r from-[rgb(253_186_116/0.3)] to-[rgb(220_38_38/0.8)]"
							aria-hidden="true"
						></span>
						<span>More clicks</span>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root class="gap-3">
				<Card.Header>
					<Card.Title>Most clicked elements</Card.Title>
					<Card.Description>On {data.path}, including clicks without a position.</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-1 text-sm">
					<div class="flex justify-between px-2 text-xs text-muted-foreground">
						<span>Element</span>
						<span>Clicks</span>
					</div>
					{#each map.elements as element (`${element.selector}\u0000${element.text}\u0000${element.other}`)}
						<div
							class="relative flex items-center justify-between gap-4 overflow-hidden rounded-md px-2 py-1.5"
							title={element.selector}
						>
							<span
								class="absolute inset-y-0 left-0 rounded-md bg-primary/10"
								style:width="{(element.clicks / maxClicks) * 100}%"
								aria-hidden="true"
							></span>
							<span class="relative grid min-w-0">
								<span class="truncate font-medium">
									{element.text || (element.other ? 'Not a button or link' : 'No text')}
								</span>
								<code class="truncate text-xs text-muted-foreground">{element.selector}</code>
							</span>
							<span class="relative tabular-nums">{element.clicks.toLocaleString()}</span>
						</div>
					{:else}
						<p class="px-2 py-6 text-center text-muted-foreground">
							No clicks on this page and device for this range
						</p>
					{/each}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>
