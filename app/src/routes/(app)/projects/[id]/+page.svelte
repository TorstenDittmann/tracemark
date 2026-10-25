<script lang="ts">
import Activity from '@lucide/svelte/icons/activity';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
import ChartSpline from '@lucide/svelte/icons/chart-spline';
import Check from '@lucide/svelte/icons/check';
import Eye from '@lucide/svelte/icons/eye';
import KeyRound from '@lucide/svelte/icons/key-round';
import LoaderCircle from '@lucide/svelte/icons/loader-circle';
import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
import PartyPopper from '@lucide/svelte/icons/party-popper';
import Sparkles from '@lucide/svelte/icons/sparkles';
import ToggleRight from '@lucide/svelte/icons/toggle-right';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import UserPlus from '@lucide/svelte/icons/user-plus';
import Users from '@lucide/svelte/icons/users';
import { onMount } from 'svelte';
import { toast } from 'svelte-sonner';
import LineChart from '#lib/components/charts/line-chart.svelte';
import CopyButton from '#lib/components/copy-button.svelte';
import LiveDot from '#lib/components/live-dot.svelte';
import InstallGuide from '#lib/components/onboarding/install-guide.svelte';
import StatCard from '#lib/components/stat-card.svelte';
import * as Alert from '#lib/components/ui/alert/index.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { timeAgo } from '#lib/time.js';
import { enhance } from '$app/forms';
import { invalidate } from '$app/navigation';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const base = $derived(`/projects/${data.project.id}`);
const live = $derived(Boolean(data.stats?.lastEventAt));

// Poll quickly while waiting for the first event, slower once the live feed is showing.
let now = $state(Date.now());
onMount(() => {
	let timer: ReturnType<typeof setTimeout>;
	const tick = async () => {
		if (document.visibilityState === 'visible') {
			await invalidate('project:home');
			now = Date.now();
		}
		timer = setTimeout(tick, live ? 15_000 : 4_000);
	};
	timer = setTimeout(tick, live ? 15_000 : 4_000);
	return () => clearTimeout(timer);
});

// Celebrate the moment the first event lands while the guide is open.
let wasLive: boolean | undefined;
let celebrate = $state(false);
$effect(() => {
	if (wasLive === false && live && !addingMock) {
		celebrate = true;
		toast.success('Your first event arrived', {
			description: 'Tracemark is receiving data from this project.'
		});
	}
	wasLive = live;
});

let addingMock = $state(false);

const steps = $derived([
	{
		done: live,
		title: 'Send your first event',
		text: 'Install an SDK and open your site or app.',
		href: undefined
	},
	{
		done: data.checklist.insights > 0,
		title: 'Save an insight',
		text: 'Chart a trend, funnel, retention, paths, lifecycle or stickiness.',
		href: `${base}/insights/trends`,
		icon: ChartSpline
	},
	{
		done: data.checklist.flags > 0,
		title: 'Create a feature flag',
		text: 'Roll out a change to some of your users.',
		href: `${base}/flags`,
		icon: ToggleRight
	},
	{
		done: data.checklist.members > 1,
		title: 'Invite your team',
		text: 'Analytics is better together.',
		href: `/organizations/${data.project.organizationId}`,
		icon: UserPlus
	}
]);
const doneCount = $derived(steps.filter((s) => s.done).length);

const web = $derived(data.web);
const visitorTrend = $derived(web?.series.map((p) => p.visitors) ?? []);
const pageviewTrend = $derived(web?.series.map((p) => p.pageviews) ?? []);

function topRows(rows: { value: string; visitors: number }[] | undefined, empty: string) {
	const list = (rows ?? []).slice(0, 6);
	const max = Math.max(1, ...list.map((r) => r.visitors));
	return list.map((r) => ({
		label: r.value || empty,
		visitors: r.visitors,
		share: r.visitors / max
	}));
}
const topPages = $derived(topRows(web?.breakdowns.page, '(unknown)'));
const topSources = $derived(topRows(web?.breakdowns.referrer, 'Direct'));

function where(properties: Record<string, unknown>): string {
	const path = properties.$pathname ?? properties.$current_url;
	return typeof path === 'string' ? path : '';
}
</script>

<svelte:head>
	<title>{data.project.name} · Tracemark</title>
</svelte:head>

{#snippet checklistCard()}
	<Card.Root class="gap-4">
		<Card.Header>
			<div class="flex items-center justify-between gap-2">
				<Card.Title>Get set up</Card.Title>
				<span class="text-xs font-medium text-muted-foreground tabular-nums">
					{doneCount}
					of {steps.length}
				</span>
			</div>
			<div class="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					class="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
					style="width: {(doneCount / steps.length) * 100}%"
				></div>
			</div>
		</Card.Header>
		<Card.Content class="grid gap-1 px-3">
			{#each steps as step (step.title)}
				<svelte:element
					this={step.href && !step.done ? 'a' : 'div'}
					href={step.href && !step.done ? step.href : undefined}
					class={[
						'group flex items-center gap-3 rounded-lg p-2 transition-colors',
						step.href && !step.done && 'hover:bg-accent'
					]}
				>
					<span
						class={[
							'flex size-6 shrink-0 items-center justify-center rounded-full border transition-all duration-300',
							step.done ? 'border-success bg-success text-white' : 'bg-background'
						]}
					>
						{#if step.done}
							<Check class="size-3.5" />
						{/if}
					</span>
					<span class="grid min-w-0 flex-1 leading-tight">
						<span
							class={['text-sm font-medium', step.done && 'text-muted-foreground line-through']}
						>
							{step.title}
						</span>
						{#if !step.done}
							<span class="truncate text-xs text-muted-foreground">{step.text}</span>
						{/if}
					</span>
					{#if step.href && !step.done}
						<ArrowRight
							class="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
						/>
					{/if}
				</svelte:element>
			{/each}
		</Card.Content>
	</Card.Root>
{/snippet}

{#if !data.stats}
	<Alert.Root>
		<TriangleAlert />
		<Alert.Title>Event data is unavailable</Alert.Title>
		<Alert.Description
			>ClickHouse could not be reached. Check that it is running.</Alert.Description
		>
	</Alert.Root>
{/if}

{#if !live}
	<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
		<div class="grid content-start gap-6">
			<Card.Root class="gap-0 overflow-hidden py-0">
				<div class="flex flex-wrap items-center justify-between gap-4 border-b p-6">
					<div class="grid gap-1">
						<h2 class="text-lg font-semibold tracking-tight">Install Tracemark</h2>
						<p class="text-sm text-muted-foreground">
							Pick your framework and follow the steps. It only takes a few minutes.
						</p>
					</div>
					<div
						class="flex items-center gap-2 rounded-full border bg-muted/50 py-1 pr-3 pl-2 text-xs"
					>
						<LiveDot tone="primary" />
						<span class="font-medium">Listening for events</span>
					</div>
				</div>
				<div class="p-6">
					<InstallGuide publicKey={data.project.publicKey} host={data.host} {live} />
				</div>
				<div class="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-6 py-4">
					<KeyRound class="size-4 text-muted-foreground" />
					<span class="text-sm text-muted-foreground">Public key</span>
					<code class="min-w-0 flex-1 truncate font-mono text-sm">{data.project.publicKey}</code>
					<CopyButton
						text={data.project.publicKey}
						label="Copy key"
						showLabel
						size="sm"
						variant="outline"
					/>
				</div>
			</Card.Root>
		</div>
		<div class="grid content-start gap-6">
			{@render checklistCard()}
			<Card.Root class="gap-3">
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-sm">
						<Sparkles class="size-4 text-primary" />
						Just looking around?
					</Card.Title>
					<Card.Description>
						Fill this project with a month of mock data: web traffic, product events, errors, AI
						traces, people, companies, flags, an experiment and a dashboard. Remove it any time in
						Settings.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form
						method="POST"
						action="?/addMockData"
						use:enhance={() => {
							addingMock = true;
							return async ({ result, update }) => {
								if (result.type === 'success') {
									const count = Number(result.data?.mockEvents ?? 0);
									toast.success('Mock data added', {
										description: `${count.toLocaleString()} events from made-up people and companies.`
									});
								} else if (result.type === 'failure') {
									toast.error(String(result.data?.message ?? 'Could not add mock data.'));
								}
								await update({ invalidateAll: true });
								addingMock = false;
							};
						}}
					>
						<Button type="submit" variant="outline" size="sm" disabled={addingMock}>
							{#if addingMock}
								<LoaderCircle class="animate-spin" />
								Adding mock data…
							{:else}
								<Sparkles />
								Add mock data
							{/if}
						</Button>
					</form>
				</Card.Content>
			</Card.Root>
			<Card.Root class="gap-3">
				<Card.Header>
					<Card.Title class="text-sm">Privacy-friendly by default</Card.Title>
					<Card.Description>
						Add <code class="rounded bg-muted px-1 font-mono text-xs">cookieless: true</code> to the
						browser SDK to store nothing on visitors' devices. They're counted by a hash that
						changes daily.
					</Card.Description>
				</Card.Header>
			</Card.Root>
		</div>
	</div>
{:else}
	<div class="grid gap-6">
		{#if celebrate}
			<div
				class="flex items-center gap-4 rounded-xl border border-success/30 bg-success/10 p-4 animate-enter"
				role="status"
			>
				<span class="flex size-10 items-center justify-center rounded-full bg-success text-white">
					<PartyPopper class="size-5" />
				</span>
				<div class="grid flex-1 gap-0.5">
					<p class="font-medium">You're live!</p>
					<p class="text-sm text-muted-foreground">
						Events are flowing in. Here's your project at a glance.
					</p>
				</div>
				<Button variant="ghost" size="sm" onclick={() => (celebrate = false)}>Dismiss</Button>
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
			<StatCard
				label="Visitors · 7 days"
				value={web ? web.overview.visitors.toLocaleString() : '–'}
				icon={Users}
				trend={visitorTrend}
			/>
			<StatCard
				label="Page views · 7 days"
				value={web ? web.overview.pageviews.toLocaleString() : '–'}
				icon={Eye}
				trend={pageviewTrend}
			/>
			<StatCard
				label="Events · 24 hours"
				value={data.stats ? data.stats.last24h.toLocaleString() : '–'}
				icon={MousePointerClick}
				hint="{data.stats ? data.stats.people24h.toLocaleString() : '–'} people"
			/>
			<StatCard
				label="Last event"
				value={data.stats?.lastEventAt ? timeAgo(data.stats.lastEventAt, now) : '–'}
				icon={Activity}
			>
				{#snippet footer()}
					<span class="flex items-center gap-2 text-xs text-muted-foreground">
						<LiveDot />
						Receiving data
					</span>
				{/snippet}
			</StatCard>
		</div>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
			<Card.Root class="min-w-0">
				<Card.Header>
					<Card.Title>Visitors</Card.Title>
					<Card.Description>Unique people over the last 7 days</Card.Description>
					<Card.Action>
						<Button variant="ghost" size="sm" href="{base}/web">
							Web analytics
							<ArrowUpRight />
						</Button>
					</Card.Action>
				</Card.Header>
				<Card.Content>
					{#if web}
						<LineChart
							lines={[{ key: 'visitors', label: 'Visitors', data: visitorTrend }]}
							buckets={web.series.map((p) => p.t)}
							bucket={web.bucket}
							height={260}
						/>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root class="min-w-0 gap-3">
				<Card.Header>
					<Card.Title class="flex items-center gap-2"><LiveDot /> Live events</Card.Title>
					<Card.Action>
						<Button variant="ghost" size="sm" href="{base}/events">
							All
							<ArrowUpRight />
						</Button>
					</Card.Action>
				</Card.Header>
				<Card.Content class="px-3">
					<ul class="grid">
						{#each data.recent as event (event.uuid)}
							<li
								class="flex items-center gap-3 rounded-lg px-3 py-2 animate-enter hover:bg-muted/50"
							>
								<span class="size-1.5 shrink-0 rounded-full bg-primary/60"></span>
								<span class="grid min-w-0 flex-1 leading-tight">
									<span class="truncate font-mono text-xs font-medium">{event.event}</span>
									<span class="truncate text-xs text-muted-foreground">
										{where(event.properties) || event.person}
									</span>
								</span>
								<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
									{timeAgo(event.timestamp, now)}
								</span>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			{#each [
				{ title: 'Top pages', rows: topPages },
				{ title: 'Top sources', rows: topSources }
			] as panel (panel.title)}
				<Card.Root class="min-w-0 gap-3">
					<Card.Header>
						<Card.Title>{panel.title}</Card.Title>
						<Card.Description>Visitors, last 7 days</Card.Description>
					</Card.Header>
					<Card.Content class="grid gap-1">
						{#each panel.rows as row (row.label)}
							<div
								class="relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-1.5 text-sm"
							>
								<span
									class="absolute inset-y-0 left-0 rounded-md bg-primary/10 transition-[width] duration-700 ease-out"
									style="width: {row.share * 100}%"
								></span>
								<span class="relative truncate">{row.label}</span>
								<span class="relative font-medium tabular-nums"
									>{row.visitors.toLocaleString()}</span
								>
							</div>
						{:else}
							<p class="py-6 text-center text-sm text-muted-foreground">No page views yet.</p>
						{/each}
					</Card.Content>
				</Card.Root>
			{/each}
			{#if doneCount < steps.length}
				{@render checklistCard()}
			{:else}
				<Card.Root class="gap-3">
					<Card.Header>
						<Card.Title>Public key</Card.Title>
						<Card.Description>For SDK setup in more apps or services.</Card.Description>
					</Card.Header>
					<Card.Content class="flex items-center gap-2">
						<code
							class="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm"
						>
							{data.project.publicKey}
						</code>
						<CopyButton
							text={data.project.publicKey}
							label="Copy key"
							variant="outline"
							size="icon"
						/>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	</div>
{/if}
