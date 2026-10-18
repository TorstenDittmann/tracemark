<script lang="ts">
import {
	ALERT_KINDS,
	ALERT_WINDOWS,
	type AlertKind,
	COOLDOWNS,
	cooldownLabel,
	type RuleDraft
} from '#lib/alerts.js';
import { Button } from '#lib/components/ui/button/index.js';
import { Checkbox } from '#lib/components/ui/checkbox/index.js';
import * as Dialog from '#lib/components/ui/dialog/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import * as NativeSelect from '#lib/components/ui/native-select/index.js';
import { enhance } from '$app/forms';

let {
	open = $bindable(false),
	rule,
	destinations,
	eventNames
}: {
	open?: boolean;
	/** The rule being edited, or a blank one for a new rule. */
	rule: RuleDraft;
	destinations: { id: string; name: string }[];
	eventNames: string[];
} = $props();

let message = $state<string | null>(null);
// The page remounts this dialog for each rule or destination it opens, so nothing carries over.
let busy = $state(false);

let kind = $derived<AlertKind>(rule.spec.kind);
const issue = $derived(
	rule.spec.kind === 'issue' ? rule.spec.config : { newIssues: true, regressions: true }
);
const threshold = $derived(
	rule.spec.kind === 'issue'
		? { window: '1h', threshold: kind === 'ai_cost' ? 10 : 100 }
		: rule.spec.config
);
const metric = $derived(
	rule.spec.kind === 'metric' ? rule.spec.config : { event: '', comparison: 'above' }
);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{rule.id ? 'Edit rule' : 'New rule'}</Dialog.Title>
			<Dialog.Description>
				Checked every minute. Saving a rule starts it over, so a condition that holds now fires
				again.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/saveRule"
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
			{#if rule.id}
				<input type="hidden" name="id" value={rule.id}>
			{/if}
			<div class="grid gap-1.5">
				<Label for="rule-name">Name</Label>
				<Input
					id="rule-name"
					name="name"
					required
					maxlength={100}
					placeholder="Checkout errors"
					value={rule.name}
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="rule-kind">Alert on</Label>
				<NativeSelect.Root id="rule-kind" name="kind" class="w-full" bind:value={kind}>
					{#each Object.entries(ALERT_KINDS) as [value, label] (value)}
						<NativeSelect.Option {value}>{label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>

			{#if kind === 'issue'}
				<fieldset class="grid gap-2 text-sm">
					<legend class="mb-1.5 font-medium">When</legend>
					<Label class="flex items-center gap-2 font-normal">
						<Checkbox name="newIssues" checked={issue.newIssues} />
						A new issue appears
					</Label>
					<Label class="flex items-center gap-2 font-normal">
						<Checkbox name="regressions" checked={issue.regressions} />
						A resolved issue happens again
					</Label>
				</fieldset>
			{:else}
				{#if kind === 'metric'}
					<div class="grid gap-1.5">
						<Label for="rule-event">Event</Label>
						<Input
							id="rule-event"
							name="event"
							list="rule-event-names"
							maxlength={200}
							placeholder="Any event"
							value={metric.event}
							class="font-mono"
						/>
						<datalist id="rule-event-names">
							{#each eventNames as name (name)}
								<option value={name}></option>
							{/each}
						</datalist>
					</div>
				{/if}
				<div class="grid gap-3 sm:grid-cols-3">
					{#if kind === 'metric'}
						<div class="grid gap-1.5">
							<Label for="rule-comparison">Count is</Label>
							<NativeSelect.Root
								id="rule-comparison"
								name="comparison"
								class="w-full"
								value={metric.comparison}
							>
								<NativeSelect.Option value="above">Above</NativeSelect.Option>
								<NativeSelect.Option value="below">Below</NativeSelect.Option>
							</NativeSelect.Root>
						</div>
					{/if}
					<div class="grid gap-1.5">
						<Label for="rule-threshold">
							{kind === 'ai_cost' ? 'Cost above (USD)' : 'Threshold'}
						</Label>
						<Input
							id="rule-threshold"
							name="threshold"
							type="number"
							min="0"
							step="any"
							required
							value={threshold.threshold}
						/>
					</div>
					<div class="grid gap-1.5">
						<Label for="rule-window">In the</Label>
						<NativeSelect.Root
							id="rule-window"
							name="window"
							class="w-full"
							value={threshold.window}
						>
							{#each Object.entries(ALERT_WINDOWS) as [value, { label }] (value)}
								<NativeSelect.Option {value}>{label}</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-2 sm:items-end">
					<div class="grid gap-1.5">
						<Label for="rule-cooldown">Cooldown</Label>
						<NativeSelect.Root
							id="rule-cooldown"
							name="cooldown"
							class="w-full"
							value={String(rule.cooldownMinutes)}
						>
							{#each COOLDOWNS as minutes (minutes)}
								<NativeSelect.Option value={String(minutes)}>
									{cooldownLabel(minutes)}
								</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</div>
					<Label class="flex h-9 items-center gap-2 font-normal">
						<Checkbox name="notifyResolved" checked={rule.notifyResolved} />
						Also notify when it clears
					</Label>
				</div>
			{/if}

			<fieldset class="grid gap-2 text-sm">
				<legend class="mb-1.5 font-medium">Notify</legend>
				{#each destinations as destination (destination.id)}
					<Label class="flex items-center gap-2 font-normal">
						<Checkbox
							name="destination"
							value={destination.id}
							checked={rule.destinationIds.includes(destination.id)}
						/>
						{destination.name}
					</Label>
				{/each}
			</fieldset>

			<Label class="flex items-center gap-2 font-normal">
				<Checkbox name="enabled" checked={rule.enabled} />
				Enabled
			</Label>

			{#if message}
				<p class="text-sm text-destructive" role="alert">{message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
