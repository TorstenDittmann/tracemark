<script lang="ts">
import { ALERT_FORMATS, type AlertFormat, type DestinationDraft } from '#lib/alerts.js';
import { Button } from '#lib/components/ui/button/index.js';
import { Checkbox } from '#lib/components/ui/checkbox/index.js';
import * as Dialog from '#lib/components/ui/dialog/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import * as NativeSelect from '#lib/components/ui/native-select/index.js';
import { enhance } from '$app/forms';

let {
	open = $bindable(false),
	destination
}: {
	open?: boolean;
	/** The destination being edited, or a blank one for a new destination. */
	destination: DestinationDraft;
} = $props();

let message = $state<string | null>(null);
// The page remounts this dialog for each rule or destination it opens, so nothing carries over.
let busy = $state(false);

const hints: Record<AlertFormat, string> = {
	json: 'A JSON body with the alert’s title, text, link and values, for your own endpoint.',
	slack: 'A Slack incoming webhook URL, from a Slack app’s Incoming Webhooks page.',
	discord: 'A Discord channel webhook URL, from the channel’s Integrations settings.'
};
let format = $derived(destination.format);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{destination.id ? 'Edit destination' : 'New destination'}</Dialog.Title>
			<Dialog.Description>
				Alerts are sent as an HTTP POST to this URL. Rules pick which destinations they notify.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/saveDestination"
			class="grid gap-4"
			use:enhance={() => {
				busy = true;
				message = null;
				return async ({ result, update }) => {
					busy = false;
					if (result.type === 'failure') {
						message = String(result.data?.message ?? 'Could not save.');
						return;
					}
					await update({ reset: false });
					if (result.type === 'success') open = false;
				};
			}}
		>
			{#if destination.id}
				<input type="hidden" name="id" value={destination.id}>
			{/if}
			<div class="grid gap-1.5">
				<Label for="destination-name">Name</Label>
				<Input
					id="destination-name"
					name="name"
					required
					maxlength={100}
					placeholder="#alerts on Slack"
					value={destination.name}
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="destination-format">Format</Label>
				<NativeSelect.Root id="destination-format" name="format" class="w-full" bind:value={format}>
					{#each Object.entries(ALERT_FORMATS) as [value, label] (value)}
						<NativeSelect.Option {value}>{label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
				<p class="text-xs text-muted-foreground">{hints[format]}</p>
			</div>
			<div class="grid gap-1.5">
				<Label for="destination-url">Webhook URL</Label>
				<Input
					id="destination-url"
					name="url"
					type="url"
					required
					maxlength={2000}
					placeholder="https://hooks.slack.com/services/…"
					value={destination.url}
					class="font-mono"
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="destination-secret">Signing secret (optional)</Label>
				<Input
					id="destination-secret"
					name="secret"
					type="password"
					autocomplete="off"
					maxlength={200}
					placeholder={destination.hasSecret ? 'Leave empty to keep the current secret' : ''}
				/>
				<p class="text-xs text-muted-foreground">
					Signs each body with HMAC-SHA256, sent as
					<code class="font-mono">X-Tracemark-Signature: sha256=…</code>
				</p>
				{#if destination.hasSecret}
					<Label class="mt-1 flex items-center gap-2 font-normal">
						<Checkbox name="removeSecret" />
						Remove the secret
					</Label>
				{/if}
			</div>
			{#if message}
				<p class="text-sm text-destructive" role="alert">{message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save destination'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
