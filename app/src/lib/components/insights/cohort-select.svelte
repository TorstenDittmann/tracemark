<script lang="ts">
import { selectClass } from './editor.svelte.js';

let {
	value,
	cohorts,
	onchange
}: {
	value: string | undefined;
	cohorts: { id: string; name: string }[];
	onchange: (cohort: string | undefined) => void;
} = $props();

const missing = $derived(value !== undefined && !cohorts.some((c) => c.id === value));
</script>

<label class="flex items-center gap-2 text-sm">
	<span class="font-medium">People</span>
	<select
		class={selectClass}
		value={value ?? ''}
		onchange={(e) => onchange(e.currentTarget.value || undefined)}
	>
		<option value="">Everyone</option>
		{#if missing}
			<option {value}>In a deleted cohort</option>
		{/if}
		{#each cohorts as cohort (cohort.id)}
			<option value={cohort.id}>In {cohort.name}</option>
		{/each}
	</select>
</label>
