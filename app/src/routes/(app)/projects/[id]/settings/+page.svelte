<script lang="ts">
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { RETENTION_DAYS, retentionLabel } from '#lib/retention.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let confirmName = $state('');
let showSecret = $state(false);
let mockBusy = $state<'add' | 'remove' | null>(null);
let price = $state({ model: '', input: '', output: '', cacheRead: '', cacheWrite: '' });

function editPrice(p: PageProps['data']['modelPrices'][number]) {
	price = {
		model: p.model,
		input: String(p.input),
		output: String(p.output),
		cacheRead: p.cacheRead === undefined ? '' : String(p.cacheRead),
		cacheWrite: p.cacheWrite === undefined ? '' : String(p.cacheWrite)
	};
}
let priceSearch = $state('');
const shownPrices = $derived.by(() => {
	const query = priceSearch.trim().toLowerCase();
	return query ? data.modelPrices.filter((p) => p.model.includes(query)) : data.modelPrices;
});
const usd = (value: number | undefined) => (value === undefined ? '' : `$${value}`);

const canManage = $derived(data.role === 'owner' || data.role === 'admin');
const messageFor = (action: string) => (form?.action === action ? form.message : null);

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<svelte:head>
	<title>Settings · {data.project.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>Name</Card.Title>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/rename"
				class="flex gap-2"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<Label for="name" class="sr-only">Project name</Label>
				<Input
					id="name"
					name="name"
					required
					maxlength={100}
					value={data.project.name}
					class="max-w-sm"
				/>
				<Button type="submit" variant="outline">Save</Button>
			</form>
			{#if messageFor('rename')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">{messageFor('rename')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Rotate public key</Card.Title>
			<Card.Description>
				Creates a new key. The old one stops working within about a minute, so events from anything
				still using it are rejected.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/rotate"
				use:enhance={({ cancel }) => {
					if (!confirm('Rotate the key? Events sent with the old key will be rejected.')) cancel();
				}}
			>
				<Button type="submit" variant="outline" disabled={!canManage}>Rotate key</Button>
			</form>
			{#if messageFor('rotate')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">{messageFor('rotate')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Secret key</Card.Title>
			<Card.Description>
				For server SDKs that evaluate feature flags locally, for uploading source maps and for the
				query API, which can read all of this project's data. Keep it on your servers and in CI;
				never put it in a browser or app.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#if data.secretKey}
				<div class="flex max-w-xl gap-2">
					<Label for="secret-key" class="sr-only">Secret key</Label>
					<Input
						id="secret-key"
						readonly
						type={showSecret ? 'text' : 'password'}
						value={data.secretKey}
						class="font-mono"
					/>
					<Button type="button" variant="outline" onclick={() => (showSecret = !showSecret)}>
						{showSecret ? 'Hide' : 'Show'}
					</Button>
				</div>
				<form
					method="POST"
					action="?/rotateSecret"
					use:enhance={({ cancel }) => {
						if (
							!confirm('Rotate the secret key? Servers and scripts using the old key stop working.')
						)
							cancel();
					}}
				>
					<Button type="submit" variant="outline">Rotate secret key</Button>
				</form>
			{:else}
				<p class="text-sm text-muted-foreground">
					Only organization owners and admins can see the secret key.
				</p>
			{/if}
			{#if messageFor('rotateSecret')}
				<p class="text-sm text-muted-foreground" role="status">{messageFor('rotateSecret')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0">
		<Card.Header>
			<Card.Title>Source maps</Card.Title>
			<Card.Description>
				Uploaded with
				<code class="font-mono">npx @tracemark/cli sourcemaps upload ./dist --release 1.4.0</code>,
				so issues show your original source. See docs/errors.md.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#if data.sourcemaps.length}
				<div class="relative overflow-x-auto">
					<table class="data-table w-full text-sm">
						<thead class="text-left text-xs text-muted-foreground">
							<tr>
								<th class="py-2 pr-4 font-normal">Release</th>
								<th class="px-4 py-2 text-right font-normal">Files</th>
								<th class="px-4 py-2 text-right font-normal">Size</th>
								<th class="px-4 py-2 font-normal">Uploaded</th>
								<th class="py-2 pl-4"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.sourcemaps as upload (upload.release)}
								<tr class="border-t">
									<td class="max-w-60 truncate py-2 pr-4 font-mono">
										{#if upload.release}
											{upload.release}
										{:else}
											<span class="font-sans text-muted-foreground">Any release</span>
										{/if}
									</td>
									<td class="px-4 py-2 text-right tabular-nums">{upload.files}</td>
									<td class="px-4 py-2 text-right whitespace-nowrap tabular-nums">
										{formatBytes(upload.size)}
									</td>
									<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">
										{dateFormat.format(upload.uploadedAt)}
									</td>
									<td class="py-2 pl-4 text-right">
										{#if canManage}
											<form
												method="POST"
												action="?/deleteSourcemaps"
												use:enhance={({ cancel }) => {
													if (!confirm('Delete the source maps of this release?')) cancel();
												}}
											>
												<input type="hidden" name="release" value={upload.release}>
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
				<p class="text-sm text-muted-foreground">No source maps uploaded yet.</p>
			{/if}
			{#if messageFor('deleteSourcemaps')}
				<p class="text-sm text-muted-foreground" role="status">{messageFor('deleteSourcemaps')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Model prices</Card.Title>
			<Card.Description>
				USD per million tokens, used to compute the cost of AI generations as they arrive. Built-in
				prices come from
				<a class="underline" href="https://models.dev" target="_blank" rel="noreferrer"
					>models.dev</a
				>
				and update daily. A model uses the price with its exact name, else the longest name it
				starts with. Cached tokens cost the input price unless set; changes apply to new events
				only.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<Input
				type="search"
				placeholder="Search {data.modelPrices.length} models"
				aria-label="Search models"
				bind:value={priceSearch}
			/>
			<div class="relative max-h-96 overflow-auto">
				<table class="data-table w-full text-sm">
					<thead class="sticky top-0 bg-card text-left text-xs text-muted-foreground">
						<tr>
							<th class="py-2 pr-4 font-normal">Model</th>
							<th class="px-4 py-2 text-right font-normal">Input</th>
							<th class="px-4 py-2 text-right font-normal">Output</th>
							<th class="px-4 py-2 text-right font-normal">Cache read</th>
							<th class="px-4 py-2 text-right font-normal">Cache write</th>
							<th class="py-2 pl-4"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each shownPrices as p (p.model)}
							<tr class="border-t">
								<td class="py-2 pr-4 font-mono whitespace-nowrap">
									{p.model}
									{#if p.custom}
										<span class="ml-1 font-sans text-xs text-muted-foreground">yours</span>
									{/if}
								</td>
								<td class="px-4 py-2 text-right tabular-nums">{usd(p.input)}</td>
								<td class="px-4 py-2 text-right tabular-nums">{usd(p.output)}</td>
								<td class="px-4 py-2 text-right tabular-nums text-muted-foreground">
									{usd(p.cacheRead)}
								</td>
								<td class="px-4 py-2 text-right tabular-nums text-muted-foreground">
									{usd(p.cacheWrite)}
								</td>
								<td class="py-2 pl-4 text-right whitespace-nowrap">
									{#if canManage}
										<Button type="button" variant="ghost" size="sm" onclick={() => editPrice(p)}>
											Edit
										</Button>
										{#if p.custom}
											<form method="POST" action="?/deleteModelPrice" class="inline" use:enhance>
												<input type="hidden" name="model" value={p.model}>
												<Button type="submit" variant="ghost" size="sm">Reset</Button>
											</form>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if canManage}
				<form
					method="POST"
					action="?/setModelPrice"
					class="grid gap-3 sm:grid-cols-[2fr_repeat(4,1fr)_auto] sm:items-end"
					use:enhance={() =>
						async ({ result, update }) => {
							await update({ reset: false });
							if (result.type === 'success') {
								price = { model: '', input: '', output: '', cacheRead: '', cacheWrite: '' };
							}
						}}
				>
					<div class="grid gap-1.5">
						<Label for="price-model">Model</Label>
						<Input
							id="price-model"
							name="model"
							required
							placeholder="gpt-4o"
							bind:value={price.model}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="price-input">Input</Label>
						<Input
							id="price-input"
							name="input"
							required
							inputmode="decimal"
							bind:value={price.input}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="price-output">Output</Label>
						<Input
							id="price-output"
							name="output"
							required
							inputmode="decimal"
							bind:value={price.output}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="price-cache-read">Cache read</Label>
						<Input
							id="price-cache-read"
							name="cacheRead"
							inputmode="decimal"
							bind:value={price.cacheRead}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="price-cache-write">Cache write</Label>
						<Input
							id="price-cache-write"
							name="cacheWrite"
							inputmode="decimal"
							bind:value={price.cacheWrite}
						/>
					</div>
					<Button type="submit" variant="outline">Save price</Button>
				</form>
			{/if}
			{#if messageFor('setModelPrice') ?? messageFor('deleteModelPrice')}
				<p class="text-sm text-muted-foreground" role="status">
					{messageFor('setModelPrice') ?? messageFor('deleteModelPrice')}
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Mock data</Card.Title>
			<Card.Description>
				A month of made-up web traffic, product events, errors, AI traces, people and companies,
				plus flags, an experiment, cohorts, insights and a dashboard to explore them. Adding again
				replaces the mock events with fresh ones. Mock people and companies have ids starting with
				<code class="font-mono">demo-</code>; your own data is never changed.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-wrap gap-2">
				<form
					method="POST"
					action="?/addMockData"
					use:enhance={() => {
						mockBusy = 'add';
						return async ({ update }) => {
							await update({ reset: false });
							mockBusy = null;
						};
					}}
				>
					<Button type="submit" variant="outline" disabled={mockBusy !== null}>
						{mockBusy === 'add' ? 'Adding…' : 'Add mock data'}
					</Button>
				</form>
				<form
					method="POST"
					action="?/removeMockData"
					use:enhance={({ cancel }) => {
						if (
							!confirm(
								'Remove the mock events, and the mock flags, experiment, cohorts, insights and dashboard?'
							)
						) {
							cancel();
							return;
						}
						mockBusy = 'remove';
						return async ({ update }) => {
							await update({ reset: false });
							mockBusy = null;
						};
					}}
				>
					<Button type="submit" variant="ghost" disabled={mockBusy !== null}>
						{mockBusy === 'remove' ? 'Removing…' : 'Remove mock data'}
					</Button>
				</form>
			</div>
			{#if messageFor('addMockData') ?? messageFor('removeMockData')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">
					{messageFor('addMockData') ?? messageFor('removeMockData')}
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Data retention</Card.Title>
			<Card.Description>
				Events older than this are deleted for good, every few hours. People and their properties
				stay.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/setRetention"
				class="flex flex-wrap gap-2"
				use:enhance={({ formData, cancel }) => {
					const days = Number(formData.get('retention'));
					const current = data.project.retentionDays;
					if (days && (current === null || days < current)) {
						const label = retentionLabel(days).toLowerCase();
						if (!confirm(`Delete every event older than ${label}? This cannot be undone.`))
							cancel();
					}
					return async ({ update }) => update({ reset: false });
				}}
			>
				<Label for="retention" class="sr-only">Keep events for</Label>
				<select id="retention" name="retention" disabled={!canManage} class={selectClass}>
					<option value="forever" selected={data.project.retentionDays === null}>
						{retentionLabel(null)}
					</option>
					{#each RETENTION_DAYS as days (days)}
						<option value={days} selected={data.project.retentionDays === days}>
							{retentionLabel(days)}
						</option>
					{/each}
				</select>
				<Button type="submit" variant="outline" disabled={!canManage}>Save</Button>
			</form>
			{#if messageFor('setRetention')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">{messageFor('setRetention')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="border-destructive/40">
		<Card.Header>
			<Card.Title>Delete project</Card.Title>
			<Card.Description>
				Deletes the project, its key and all of its events. This cannot be undone.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form method="POST" action="?/delete" class="grid max-w-sm gap-2" use:enhance>
				<Label for="confirm"
					><span>Type <strong>{data.project.name}</strong> to confirm</span></Label
				>
				<Input
					id="confirm"
					name="confirm"
					autocomplete="off"
					bind:value={confirmName}
					disabled={!canManage}
				/>
				<div>
					<Button
						type="submit"
						variant="destructive"
						disabled={!canManage || confirmName !== data.project.name}
					>
						Delete project
					</Button>
				</div>
			</form>
			{#if messageFor('delete')}
				<p class="mt-2 text-sm text-destructive" role="alert">{messageFor('delete')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if !canManage}
		<p class="text-sm text-muted-foreground">
			Only organization owners and admins can rotate keys, change retention or delete projects.
		</p>
	{/if}
</div>
