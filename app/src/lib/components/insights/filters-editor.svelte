<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import { MAX_FILTERS, OPERATORS, type Operator, type PropertyFilter } from '#lib/insights.js';
import { selectClass, withCurrent } from './editor.svelte.js';

let {
	filters,
	properties,
	onchange
}: {
	filters: PropertyFilter[];
	properties: string[];
	onchange: (filters: PropertyFilter[]) => void;
} = $props();

function update(change: (filters: PropertyFilter[]) => void) {
	const next = structuredClone($state.snapshot(filters)) as PropertyFilter[];
	change(next);
	onchange(next);
}
</script>

<section class="grid gap-2">
	<h3 class="text-sm font-medium">Filters</h3>
	{#each filters as filter, i (i)}
		<div class="flex flex-wrap items-center gap-2">
			<select
				class={selectClass}
				aria-label="Filter property"
				value={filter.property}
				onchange={(e) => update((f) => (f[i].property = e.currentTarget.value))}
			>
				{#each withCurrent(properties, filter.property) as property (property)}
					<option value={property}>{property}</option>
				{/each}
			</select>
			<select
				class={selectClass}
				aria-label="Operator"
				value={filter.operator}
				onchange={(e) =>
					update((f) => {
						const operator = e.currentTarget.value as Operator;
						f[i].operator = operator;
						if (operator === 'is_set' || operator === 'is_not_set') delete f[i].value;
						else f[i].value ??= '';
					})}
			>
				{#each Object.entries(OPERATORS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
			{#if filter.value !== undefined}
				<input
					class="{selectClass} w-40"
					aria-label="Value"
					value={filter.value}
					onchange={(e) => update((f) => (f[i].value = e.currentTarget.value))}
				>
			{/if}
			<Button
				variant="ghost"
				size="sm"
				onclick={() => update((f) => f.splice(i, 1))}
				aria-label="Remove filter"
			>
				Remove
			</Button>
		</div>
	{/each}
	{#if filters.length < MAX_FILTERS && properties.length}
		<div>
			<Button
				variant="outline"
				size="sm"
				onclick={() =>
					update((f) => f.push({ property: properties[0], operator: 'eq', value: '' }))}
			>
				Add filter
			</Button>
		</div>
	{/if}
</section>
