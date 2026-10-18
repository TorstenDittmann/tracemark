<script lang="ts">
import Bell from '@lucide/svelte/icons/bell';
import Plus from '@lucide/svelte/icons/plus';
import Webhook from '@lucide/svelte/icons/webhook';
import {
	ALERT_FORMATS,
	ALERT_KINDS,
	type DestinationDraft,
	formatUsd,
	type RuleDraft,
	ruleSummary
} from '#lib/alerts.js';
import DestinationDialog from '#lib/components/alerts/destination-dialog.svelte';
import RuleDialog from '#lib/components/alerts/rule-dialog.svelte';
import EmptyState from '#lib/components/empty-state.svelte';
import StatusPill from '#lib/components/status-pill.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const canManage = $derived(data.role === 'owner' || data.role === 'admin');
const destinationNames = $derived(new Map(data.destinations.map((d) => [d.id, d.name])));
const messageFor = (...actions: string[]) =>
	form && actions.includes(String(form.action)) ? String(form.message) : null;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const when = (date: Date | null) => (date ? dateFormat.format(date) : '–');
const host = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};

const blankRule = (): RuleDraft => ({
	name: '',
	spec: { kind: 'issue', config: { newIssues: true, regressions: true } },
	destinationIds: data.destinations.map((d) => d.id),
	enabled: true,
	notifyResolved: false,
	cooldownMinutes: 60
});
const blankDestination = (): DestinationDraft => ({
	name: '',
	url: '',
	format: 'slack',
	hasSecret: false
});

let ruleOpen = $state(false);
let editingRule = $state<RuleDraft>(blankRule());
let destinationOpen = $state(false);
let editingDestination = $state<DestinationDraft>(blankDestination());
let testing = $state<string | null>(null);

function editRule(rule?: RuleDraft) {
	editingRule = rule ?? blankRule();
	ruleOpen = true;
}

function editDestination(destination?: DestinationDraft) {
	editingDestination = destination ?? blankDestination();
	destinationOpen = true;
}

function measured(rule: PageProps['data']['rules'][number]): string {
	if (rule.lastValue === null || rule.spec.kind === 'issue') return '';
	return rule.spec.kind === 'ai_cost'
		? formatUsd(rule.lastValue)
		: rule.lastValue.toLocaleString('en');
}
</script>

<svelte:head>
	<title>Alerts · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>Rules</Card.Title>
			<Card.Description>
				Checked every minute. A threshold fires once when it's crossed and, if you like, once when
				it clears; issue rules send each new issue or regression once.
			</Card.Description>
			{#if canManage}
				<Card.Action>
					<Button onclick={() => editRule()} disabled={!data.destinations.length}>
						<Plus />
						New rule
					</Button>
				</Card.Action>
			{/if}
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#if data.rules.length}
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="py-2 pr-4 font-normal">Rule</th>
								<th class="px-4 py-2 font-normal">Notifies</th>
								<th class="px-4 py-2 font-normal">Status</th>
								<th class="px-4 py-2 font-normal">Last fired</th>
								<th class="py-2 pl-4"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.rules as rule (rule.id)}
								<tr class="border-t align-top">
									<td class="max-w-96 py-2 pr-4">
										<span class="block font-medium">{rule.name}</span>
										<span class="block text-xs text-muted-foreground">
											{ALERT_KINDS[rule.spec.kind]}: {ruleSummary(rule.spec)}
										</span>
										{#if rule.lastError}
											<span class="block text-xs text-destructive">
												Last check failed: {rule.lastError}
											</span>
										{/if}
									</td>
									<td class="px-4 py-2 text-muted-foreground">
										{rule.destinationIds.map((id) => destinationNames.get(id)).join(', ') ||
											'Nobody'}
									</td>
									<td class="px-4 py-2 whitespace-nowrap">
										{#if !rule.enabled}
											<StatusPill tone="muted">Paused</StatusPill>
										{:else if rule.state === 'firing'}
											<StatusPill tone="destructive" pulse>Firing</StatusPill>
										{:else}
											<StatusPill tone="success">OK</StatusPill>
										{/if}
										{#if measured(rule)}
											<span class="ml-1 text-xs text-muted-foreground tabular-nums">
												{measured(rule)}
											</span>
										{/if}
									</td>
									<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
										{when(rule.lastFiredAt)}
									</td>
									<td class="py-2 pl-4 text-right whitespace-nowrap">
										{#if canManage}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onclick={() => editRule(rule)}
											>
												Edit
											</Button>
											<form method="POST" action="?/toggleRule" class="inline" use:enhance>
												<input type="hidden" name="id" value={rule.id}>
												<input type="hidden" name="enabled" value={String(!rule.enabled)}>
												<Button type="submit" variant="ghost" size="sm">
													{rule.enabled ? 'Pause' : 'Resume'}
												</Button>
											</form>
											<form
												method="POST"
												action="?/deleteRule"
												class="inline"
												use:enhance={({ cancel }) => {
													if (!confirm(`Delete the rule ${rule.name}?`)) cancel();
												}}
											>
												<input type="hidden" name="id" value={rule.id}>
												<Button type="submit" variant="ghost" size="sm">Delete</Button>
											</form>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<EmptyState
					icon={Bell}
					title="No alert rules yet"
					description={data.destinations.length
						? 'Create a rule to hear about new errors, regressions, event counts or AI spend.'
						: 'Add a destination first, then create rules that notify it.'}
				/>
			{/if}
			{#if messageFor('toggleRule', 'deleteRule', 'saveRule')}
				<p class="text-sm text-muted-foreground" role="status">
					{messageFor('toggleRule', 'deleteRule', 'saveRule')}
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>Destinations</Card.Title>
			<Card.Description>
				Webhooks alerts are posted to: Slack and Discord incoming webhooks, or any URL that takes
				JSON. See docs/alerts.md for the payload and how to check its signature.
			</Card.Description>
			{#if canManage}
				<Card.Action>
					<Button variant="outline" onclick={() => editDestination()}>
						<Plus />
						New destination
					</Button>
				</Card.Action>
			{/if}
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#if data.destinations.length}
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="py-2 pr-4 font-normal">Destination</th>
								<th class="px-4 py-2 font-normal">Format</th>
								<th class="px-4 py-2 font-normal">Last delivery</th>
								<th class="py-2 pl-4"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.destinations as destination (destination.id)}
								<tr class="border-t align-top">
									<td class="max-w-80 py-2 pr-4">
										<span class="block font-medium">{destination.name}</span>
										<span class="block truncate font-mono text-xs text-muted-foreground">
											{host(destination.url)}
											{#if destination.hasSecret}
												<span class="font-sans">· signed</span>
											{/if}
										</span>
									</td>
									<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
										{ALERT_FORMATS[destination.format]}
									</td>
									<td class="max-w-80 px-4 py-2">
										{#if destination.lastStatus}
											<div class="flex items-center gap-2 whitespace-nowrap">
												<StatusPill
													tone={destination.lastStatus === 'ok' ? 'success' : 'destructive'}
												>
													{destination.lastStatus === 'ok' ? 'Delivered' : 'Failed'}
												</StatusPill>
												<span class="text-xs text-muted-foreground">
													{when(destination.lastDeliveredAt)}
												</span>
											</div>
											{#if destination.lastError}
												<span class="mt-1 block text-xs break-words text-destructive">
													{destination.lastError}
												</span>
											{/if}
										{:else}
											<span class="text-muted-foreground">Nothing sent yet</span>
										{/if}
									</td>
									<td class="py-2 pl-4 text-right whitespace-nowrap">
										{#if canManage}
											<form
												method="POST"
												action="?/testDestination"
												class="inline"
												use:enhance={() => {
													testing = destination.id;
													return async ({ result, update }) => {
														await update({ reset: false });
														// A failed test is recorded too, which a failure doesn't reload.
														if (result.type === 'failure') await invalidateAll();
														testing = null;
													};
												}}
											>
												<input type="hidden" name="id" value={destination.id}>
												<Button type="submit" variant="ghost" size="sm" disabled={testing !== null}>
													{testing === destination.id ? 'Sending…' : 'Send test'}
												</Button>
											</form>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onclick={() => editDestination(destination)}
											>
												Edit
											</Button>
											<form
												method="POST"
												action="?/deleteDestination"
												class="inline"
												use:enhance={({ cancel }) => {
													if (!confirm(`Delete ${destination.name}? Rules stop notifying it.`))
														cancel();
												}}
											>
												<input type="hidden" name="id" value={destination.id}>
												<Button type="submit" variant="ghost" size="sm">Delete</Button>
											</form>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<EmptyState
					icon={Webhook}
					title="No destinations yet"
					description="Add a Slack or Discord incoming webhook, or your own endpoint."
				/>
			{/if}
			{#if messageFor('testDestination', 'saveDestination', 'deleteDestination')}
				<p
					class={[
						'text-sm',
						form?.action === 'testDestination' && !String(form.message).startsWith('Sent')
							? 'text-destructive'
							: 'text-muted-foreground'
					]}
					role="status"
				>
					{messageFor('testDestination', 'saveDestination', 'deleteDestination')}
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>Recent deliveries</Card.Title>
			<Card.Description>The last 20 messages sent from this project.</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if data.deliveries.length}
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="py-2 pr-4 font-normal">Sent</th>
								<th class="px-4 py-2 font-normal">Alert</th>
								<th class="px-4 py-2 font-normal">To</th>
								<th class="py-2 pl-4 font-normal">Result</th>
							</tr>
						</thead>
						<tbody>
							{#each data.deliveries as delivery (delivery.id)}
								<tr class="border-t align-top">
									<td class="py-2 pr-4 whitespace-nowrap text-muted-foreground">
										{when(delivery.createdAt)}
									</td>
									<td class="max-w-96 px-4 py-2">{delivery.title}</td>
									<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
										{delivery.destinationName}
									</td>
									<td class="max-w-80 py-2 pl-4">
										<StatusPill tone={delivery.ok ? 'success' : 'destructive'}>
											{delivery.ok ? 'Delivered' : 'Failed'}{delivery.statusCode
												? ` · ${delivery.statusCode}`
												: ''}
										</StatusPill>
										{#if delivery.error && !delivery.ok}
											<span class="mt-1 block text-xs break-words text-muted-foreground">
												{delivery.error}
											</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">Nothing sent yet.</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if !canManage}
		<p class="text-sm text-muted-foreground">
			Only organization owners and admins can change alert rules and destinations.
		</p>
	{/if}
</div>

{#key editingRule}
	<RuleDialog
		bind:open={ruleOpen}
		rule={editingRule}
		destinations={data.destinations}
		eventNames={data.eventNames}
	/>
{/key}
{#key editingDestination}
	<DestinationDialog bind:open={destinationOpen} destination={editingDestination} />
{/key}
