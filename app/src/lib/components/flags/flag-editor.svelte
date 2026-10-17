<script lang="ts">
import {
	type FlagCondition,
	type FlagDefinition,
	type FlagFilter,
	MAX_CONDITIONS,
	MAX_FILTERS,
	MAX_VARIANTS,
	type Operator,
	parseFlag
} from '@tracemark/flags';
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { evenSplit, parsePayloads } from '#lib/flags.js';
import { OPERATORS } from '#lib/insights.js';
import { enhance } from '$app/forms';

let {
	initial,
	description: initialDescription,
	version,
	cohorts,
	properties,
	groupTypes,
	message,
	failed = false
}: {
	initial: FlagDefinition;
	description: string;
	version: number;
	cohorts: { id: string; name: string }[];
	properties: string[];
	groupTypes: string[];
	message?: string;
	failed?: boolean;
} = $props();

// The page re-keys this component on every saved version, so editing starts from what was saved.
const start = (() => structuredClone(initial))();
let flag: FlagDefinition = $state(start);
let description = $state((() => initialDescription)());
let payloadTexts: Record<string, string> = $state(
	Object.fromEntries(
		Object.entries(start.payloads).map(([key, value]) => [key, JSON.stringify(value, null, 2)])
	)
);
let saving = $state(false);

const types = $derived(
	flag.groupType && !groupTypes.includes(flag.groupType)
		? [flag.groupType, ...groupTypes]
		: groupTypes
);
const payloadKeys = $derived(flag.variants.length ? flag.variants.map((v) => v.key) : ['true']);
const variantTotal = $derived(flag.variants.reduce((sum, v) => sum + (v.rollout || 0), 0));

/** The flag as it would be saved, or the reason it can't be. */
const result = $derived.by((): { flag: FlagDefinition } | { problem: string } => {
	try {
		const texts = Object.fromEntries(payloadKeys.map((key) => [key, payloadTexts[key] ?? '']));
		const snapshot = $state.snapshot(flag) as FlagDefinition;
		return { flag: parseFlag({ ...snapshot, payloads: parsePayloads(texts) }) };
	} catch (err) {
		return { problem: err instanceof Error ? err.message : 'The flag is not valid.' };
	}
});
const changed = $derived(
	'flag' in result
		? JSON.stringify(result.flag) !== JSON.stringify(initial) || description !== initialDescription
		: true
);

function setMultivariate(on: boolean) {
	if (on) {
		flag.variants = [
			{ key: 'control', rollout: 50 },
			{ key: 'test', rollout: 50 }
		];
	} else {
		flag.variants = [];
		for (const condition of flag.conditions) delete condition.variant;
	}
}

function splitEvenly() {
	const split = evenSplit(flag.variants.length);
	flag.variants.forEach((variant, i) => {
		variant.rollout = split[i] ?? 0;
	});
}

function newFilter(type: FlagFilter['type']): FlagFilter {
	if (type === 'cohort') return { type, cohort: cohorts[0]?.id ?? '' };
	if (type === 'group') {
		return {
			type,
			groupType: flag.groupType ?? types[0] ?? '',
			property: '',
			operator: 'eq',
			value: ''
		};
	}
	return { type, property: properties[0] ?? '', operator: 'eq', value: '' };
}

function setOperator(filter: FlagFilter, operator: Operator) {
	if (filter.type === 'cohort') return;
	const next = { ...filter, operator } as FlagFilter & { value?: string };
	if (operator === 'is_set' || operator === 'is_not_set') delete next.value;
	else next.value = 'value' in filter ? filter.value : '';
	return next as FlagFilter;
}

function addCondition() {
	const condition: FlagCondition = { filters: [], rollout: 100 };
	flag.conditions.push(condition);
}
</script>

<datalist id="flag-person-properties">
	{#each properties as property (property)}
		<option value={property}></option>
	{/each}
</datalist>

<form
	method="POST"
	action="?/save"
	class="grid gap-4"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<input type="hidden" name="version" value={version}>
	<input type="hidden" name="flag" value={'flag' in result ? JSON.stringify(result.flag) : ''}>

	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>Flag</Card.Title>
		</Card.Header>
		<Card.Content class="grid gap-4 text-sm">
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={flag.active} class="size-4">
				<span class="font-medium">Serve this flag</span>
				<span class="text-muted-foreground">
					{flag.active ? 'on: conditions below decide who gets it' : 'off: everyone gets false'}
				</span>
			</label>
			<div class="grid max-w-xl gap-1.5">
				<label for="flag-key" class="font-medium">Key</label>
				<Input id="flag-key" bind:value={flag.key} maxlength={100} class="font-mono" />
				<p class="text-xs text-muted-foreground">
					Changing the key breaks code that asks for the old one.
				</p>
			</div>
			<div class="grid max-w-xl gap-1.5">
				<label for="flag-description" class="font-medium">Description</label>
				<Input id="flag-description" name="description" bind:value={description} maxlength={500} />
			</div>
			<div class="grid max-w-xl gap-1.5">
				<label for="flag-group" class="font-medium">Decide per</label>
				<select
					id="flag-group"
					class="{selectClass} w-56"
					value={flag.groupType ?? ''}
					onchange={(e) => {
						const value = e.currentTarget.value;
						if (value) flag.groupType = value;
						else delete flag.groupType;
					}}
				>
					<option value="">Person</option>
					{#each types as type (type)}
						<option value={type}>Group: {type}</option>
					{/each}
				</select>
				<p class="text-xs text-muted-foreground">
					{flag.groupType
						? `Everyone in the same ${flag.groupType} gets the same answer. Requests without one get false.`
						: 'Each person gets their own answer.'}
				</p>
			</div>
			<fieldset class="grid gap-2">
				<legend class="mb-1 font-medium">Serves</legend>
				<label class="flex items-center gap-2">
					<input
						type="radio"
						name="flag-kind"
						checked={!flag.variants.length}
						onchange={() => setMultivariate(false)}
					>
					True or false
				</label>
				<label class="flex items-center gap-2">
					<input
						type="radio"
						name="flag-kind"
						checked={flag.variants.length > 0}
						onchange={() => setMultivariate(true)}
					>
					One of several variants
				</label>
			</fieldset>
		</Card.Content>
	</Card.Root>

	{#if flag.variants.length}
		<Card.Root class="min-w-0 gap-4">
			<Card.Header>
				<Card.Title>Variants</Card.Title>
				<Card.Description>
					How people the flag is on for are split. The shares add up to 100%.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-2 text-sm">
				{#each flag.variants as variant, i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<Input
							aria-label="Variant {i + 1} key"
							bind:value={variant.key}
							maxlength={100}
							class="h-8 w-48 font-mono"
						/>
						<Input
							type="number"
							aria-label="Variant {i + 1} share in percent"
							bind:value={variant.rollout}
							min={0}
							max={100}
							step="any"
							class="h-8 w-24 tabular-nums"
						/>
						<span class="text-muted-foreground">%</span>
						<Button
							variant="ghost"
							size="sm"
							disabled={flag.variants.length <= 1}
							onclick={() => flag.variants.splice(i, 1)}
						>
							Remove
						</Button>
					</div>
				{/each}
				<div class="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={flag.variants.length >= MAX_VARIANTS}
						onclick={() =>
							flag.variants.push({ key: `variant-${flag.variants.length + 1}`, rollout: 0 })}
					>
						Add variant
					</Button>
					<Button variant="ghost" size="sm" onclick={splitEvenly}>Split evenly</Button>
					<span
						class={[
							'tabular-nums',
							Math.abs(variantTotal - 100) > 0.001 ? 'text-destructive' : 'text-muted-foreground'
						]}
					>
						Total {variantTotal}%
					</span>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>Release conditions</Card.Title>
			<Card.Description>
				Checked in order. The first condition that matches and includes the
				{flag.groupType ? 'group' : 'person'}
				in its rollout turns the flag on; if none does, it's off. A property nobody set counts as
				empty.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 text-sm">
			{#each flag.conditions as condition, c (c)}
				<section class="grid gap-3 rounded-md border p-3" aria-label="Condition {c + 1}">
					<div class="flex items-center justify-between gap-2">
						<h4 class="font-medium">Condition {c + 1}</h4>
						<Button variant="ghost" size="sm" onclick={() => flag.conditions.splice(c, 1)}>
							Remove
						</Button>
					</div>
					{#if !condition.filters.length}
						<p class="text-muted-foreground">Matches every {flag.groupType ?? 'person'}.</p>
					{/if}
					{#each condition.filters as filter, f (f)}
						<div class="flex flex-wrap items-center gap-2">
							<select
								class={selectClass}
								aria-label="Filter type"
								value={filter.type}
								onchange={(e) =>
									(condition.filters[f] = newFilter(e.currentTarget.value as FlagFilter['type']))}
							>
								<option value="person">Person property</option>
								<option value="group" disabled={!types.length}>Group property</option>
								<option value="cohort" disabled={!cohorts.length}>In cohort</option>
							</select>
							{#if filter.type === 'cohort'}
								<select class={selectClass} aria-label="Cohort" bind:value={filter.cohort}>
									{#if !cohorts.some((cohort) => cohort.id === filter.cohort)}
										<option value={filter.cohort}>Deleted cohort</option>
									{/if}
									{#each cohorts as cohort (cohort.id)}
										<option value={cohort.id}>{cohort.name}</option>
									{/each}
								</select>
							{:else}
								{#if filter.type === 'group'}
									<select class={selectClass} aria-label="Group type" bind:value={filter.groupType}>
										{#each types as type (type)}
											<option value={type}>{type}</option>
										{/each}
									</select>
								{/if}
								<input
									class="{selectClass} w-40"
									aria-label="Property"
									placeholder="property"
									list={filter.type === 'person' ? 'flag-person-properties' : undefined}
									bind:value={filter.property}
								>
								<select
									class={selectClass}
									aria-label="Operator"
									value={filter.operator}
									onchange={(e) => {
										const next = setOperator(filter, e.currentTarget.value as Operator);
										if (next) condition.filters[f] = next;
									}}
								>
									{#each Object.entries(OPERATORS) as [value, label] (value)}
										<option {value}>{label}</option>
									{/each}
								</select>
								{#if 'value' in filter}
									<input class="{selectClass} w-40" aria-label="Value" bind:value={filter.value}>
								{/if}
							{/if}
							<Button variant="ghost" size="sm" onclick={() => condition.filters.splice(f, 1)}>
								Remove
							</Button>
						</div>
					{/each}
					{#if condition.filters.length < MAX_FILTERS}
						<div>
							<Button
								variant="outline"
								size="sm"
								onclick={() => condition.filters.push(newFilter('person'))}
							>
								Add filter
							</Button>
						</div>
					{/if}
					<div class="flex flex-wrap items-center gap-2">
						<label for="rollout-{c}">Roll out to</label>
						<Input
							id="rollout-{c}"
							type="number"
							bind:value={condition.rollout}
							min={0}
							max={100}
							step="any"
							class="h-8 w-24 tabular-nums"
						/>
						<span class="text-muted-foreground">
							% of {condition.filters.length ? 'matching ' : ''}{flag.groupType
								? 'groups'
								: 'people'}
						</span>
					</div>
					{#if flag.variants.length}
						<div class="flex flex-wrap items-center gap-2">
							<label for="variant-{c}">Serve</label>
							<select
								id="variant-{c}"
								class={selectClass}
								value={condition.variant ?? ''}
								onchange={(e) => {
									const value = e.currentTarget.value;
									if (value) condition.variant = value;
									else delete condition.variant;
								}}
							>
								<option value="">Variants by their share</option>
								{#each flag.variants as variant (variant.key)}
									<option value={variant.key}>Always {variant.key}</option>
								{/each}
							</select>
						</div>
					{/if}
				</section>
			{/each}
			{#if !flag.conditions.length}
				<p class="text-muted-foreground">No conditions, so the flag is off for everyone.</p>
			{/if}
			{#if flag.conditions.length < MAX_CONDITIONS}
				<div><Button variant="outline" size="sm" onclick={addCondition}>Add condition</Button></div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root class="min-w-0 gap-4">
		<Card.Header>
			<Card.Title>Payloads</Card.Title>
			<Card.Description>
				Optional JSON your code gets along with the value, such as copy or a price. Leave empty for
				none.
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-3 text-sm">
			{#each payloadKeys as key (key)}
				<div class="grid max-w-xl gap-1.5">
					<label for="payload-{key}" class="font-medium">
						{key === 'true' && !flag.variants.length ? 'When on' : key}
					</label>
					<textarea
						id="payload-{key}"
						rows="3"
						class="min-w-0 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs dark:bg-input/30"
						placeholder={'{"price": 9}'}
						value={payloadTexts[key] ?? ''}
						oninput={(e) => (payloadTexts[key] = e.currentTarget.value)}
					></textarea>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	<div class="flex flex-wrap items-center gap-3">
		<Button type="submit" disabled={saving || 'problem' in result || !changed}>Save flag</Button>
		{#if 'problem' in result}
			<p class="text-sm text-destructive" role="alert">{result.problem}</p>
		{:else if message}
			<p class={['text-sm', failed ? 'text-destructive' : 'text-muted-foreground']} role="status">
				{message}
			</p>
		{/if}
	</div>
</form>
