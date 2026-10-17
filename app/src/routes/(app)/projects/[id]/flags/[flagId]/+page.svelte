<script lang="ts">
import FlagEditor from '#lib/components/flags/flag-editor.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { flagsHref } from '#lib/flags.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const flag = $derived(data.flag.definition);
</script>

<svelte:head>
	<title>{flag.key} · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="grid min-w-0 gap-0.5">
			<a href={flagsHref(data.project.id)} class="text-sm text-muted-foreground hover:underline">
				Feature flags
			</a>
			<h2 class="truncate font-mono text-xl font-semibold">{flag.key}</h2>
		</div>
		<div class="flex items-center gap-1">
			<form method="POST" action="?/toggle" use:enhance>
				<Button type="submit" size="sm" variant={flag.active ? 'outline' : 'default'}>
					{flag.active ? 'Turn off' : 'Turn on'}
				</Button>
			</form>
			<form method="POST" action="?/delete" use:enhance>
				<Button
					type="submit"
					size="sm"
					variant="ghost"
					onclick={(e) => {
						if (!confirm(`Delete the flag ${flag.key}? Code asking for it will get false.`))
							e.preventDefault();
					}}
				>
					Delete
				</Button>
			</form>
		</div>
	</div>
	{#if data.flag.invalid}
		<p class="text-sm text-destructive" role="alert">
			The saved rules of this flag are no longer valid, so it's served as off. Saving replaces them.
		</p>
	{/if}
	{#if form?.action === 'toggle'}
		<p class={['text-sm', form.ok ? 'text-muted-foreground' : 'text-destructive']} role="status">
			{form.message}
		</p>
	{/if}

	{#key data.flag.version}
		<FlagEditor
			initial={flag}
			description={data.flag.description}
			version={data.flag.version}
			cohorts={data.cohorts}
			properties={data.properties}
			groupTypes={data.groupTypes}
			message={form?.action === 'save' ? form.message : undefined}
			failed={form?.action === 'save' && !form.ok}
		/>
	{/key}

	<Card.Root class="min-w-0 gap-3">
		<Card.Header>
			<Card.Title>History</Card.Title>
		</Card.Header>
		<Card.Content>
			<ol class="grid gap-1 text-sm">
				{#each data.history as entry (entry.version)}
					<li class="flex flex-wrap gap-x-2">
						<span class="tabular-nums text-muted-foreground">v{entry.version}</span>
						<span>
							{entry.version === 1 ? 'Created' : 'Saved'}
							{entry.active ? 'on' : 'off'}
						</span>
						<span class="text-muted-foreground">
							{entry.changedBy ? `by ${entry.changedBy}, ` : ''}{dateFormat.format(entry.createdAt)}
						</span>
					</li>
				{/each}
			</ol>
		</Card.Content>
	</Card.Root>
</div>
