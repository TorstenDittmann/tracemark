<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let confirmName = $state('');
let showSecret = $state(false);

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
	<title>Settings · {data.project.name} · footprint</title>
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
				For server SDKs that evaluate feature flags locally and for uploading source maps. Keep it
				on your servers and in CI; never put it in a browser or app.
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
						if (!confirm('Rotate the secret key? Servers using the old key stop getting flags.'))
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
				<code class="font-mono">npx @footprint/cli sourcemaps upload ./dist --release 1.4.0</code>,
				so issues show your original source. See docs/errors.md.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3">
			{#if data.sourcemaps.length}
				<div class="relative overflow-x-auto">
					<table class="w-full text-sm">
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
			Only organization owners and admins can rotate keys or delete projects.
		</p>
	{/if}
</div>
