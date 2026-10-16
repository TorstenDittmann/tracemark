<script lang="ts">
import { RANGES, type Range } from '#lib/web.js';

let {
	value,
	ranges = Object.keys(RANGES) as Range[],
	onchange
}: { value: Range; ranges?: Range[]; onchange: (value: Range) => void } = $props();
</script>

<fieldset class="inline-flex rounded-md border p-0.5 text-sm">
	<legend class="sr-only">Date range</legend>
	{#each ranges as range (range)}
		<button
			type="button"
			title={RANGES[range].label}
			aria-pressed={value === range}
			onclick={() => onchange(range)}
			class={[
				'rounded px-2.5 py-1',
				value === range
					? 'bg-secondary font-medium text-secondary-foreground'
					: 'text-muted-foreground hover:text-foreground'
			]}
		>
			{range}
		</button>
	{/each}
</fieldset>
