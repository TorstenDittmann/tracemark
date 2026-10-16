<script lang="ts">
import { selectClass, withCurrent } from './editor.svelte.js';

let {
	value,
	properties,
	label = 'Breakdown',
	onchange
}: {
	value: string | undefined;
	properties: string[];
	label?: string;
	onchange: (value: string | undefined) => void;
} = $props();
</script>

<label class="flex items-center gap-2 text-sm">
	<span class="font-medium">{label}</span>
	<select
		class={selectClass}
		value={value ?? ''}
		onchange={(e) => onchange(e.currentTarget.value || undefined)}
	>
		<option value="">None</option>
		{#each withCurrent(properties, value) as property (property)}
			<option value={property}>{property}</option>
		{/each}
	</select>
</label>
