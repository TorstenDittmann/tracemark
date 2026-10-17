<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
let copied = $state<string | null>(null);

const snippet = $derived(`import { tracemark } from '@tracemark/browser';

tracemark.init({
	apiKey: '${data.project.publicKey}',
	host: '${data.host}'
});`);

const lastEvent = $derived(
	data.stats?.lastEventAt
		? new Date(data.stats.lastEventAt).toLocaleString(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short'
			})
		: null
);

async function copy(label: string, text: string) {
	await navigator.clipboard.writeText(text);
	copied = label;
	setTimeout(() => {
		if (copied === label) copied = null;
	}, 1500);
}
</script>

<svelte:head>
	<title>{data.project.name} · footprint</title>
</svelte:head>

<div class="grid gap-6">
	<div class="grid gap-4 sm:grid-cols-3">
		<Card.Root class="min-w-0 gap-2">
			<Card.Header>
				<Card.Description>Events in the last 24 hours</Card.Description>
				<Card.Title class="text-3xl tabular-nums">
					{data.stats ? data.stats.last24h.toLocaleString() : '–'}
				</Card.Title>
			</Card.Header>
		</Card.Root>
		<Card.Root class="min-w-0 gap-2">
			<Card.Header>
				<Card.Description>People in the last 24 hours</Card.Description>
				<Card.Title class="text-3xl tabular-nums">
					{data.stats ? data.stats.people24h.toLocaleString() : '–'}
				</Card.Title>
			</Card.Header>
		</Card.Root>
		<Card.Root class="min-w-0 gap-2">
			<Card.Header>
				<Card.Description>Last event</Card.Description>
				<Card.Title class="text-xl">
					{#if !data.stats}
						Unavailable
					{:else if lastEvent}
						{lastEvent}
					{:else}
						Waiting for the first event
					{/if}
				</Card.Title>
			</Card.Header>
		</Card.Root>
	</div>
	{#if !data.stats}
		<p class="text-sm text-muted-foreground">
			Event counts are unavailable because ClickHouse could not be reached.
		</p>
	{/if}

	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>Public key</Card.Title>
			<Card.Description>
				Safe to ship in your website or app. It can only send events, not read them.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex items-center gap-2">
			<code class="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-sm">
				{data.project.publicKey}
			</code>
			<Button variant="outline" onclick={() => copy('key', data.project.publicKey)}>
				{copied === 'key' ? 'Copied' : 'Copy'}
			</Button>
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>Install the browser SDK</Card.Title>
			<Card.Description>
				Add <code class="font-mono">@tracemark/browser</code> with your package manager, then
				initialize it once on page load. Page views are captured automatically. Add
				<code class="font-mono">cookieless: true</code>
				to store nothing on your visitors' devices; they are then counted by a hash that changes
				daily.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-2">
			<pre class="overflow-x-auto rounded-md border bg-muted p-4 font-mono text-sm">{snippet}</pre>
			<div>
				<Button variant="outline" size="sm" onclick={() => copy('snippet', snippet)}>
					{copied === 'snippet' ? 'Copied' : 'Copy snippet'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>
</div>
