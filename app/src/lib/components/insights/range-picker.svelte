<script lang="ts">
import { RANGES, type Range } from '#lib/web.js';

let {
	value,
	ranges = Object.keys(RANGES) as Range[],
	onchange
}: { value: Range; ranges?: Range[]; onchange: (value: Range) => void } = $props();
</script>

<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
	<legend class="sr-only">Date range</legend>
	{#each ranges as range (range)}
		<button
			type="button"
			title={RANGES[range].label}
			aria-pressed={value === range}
			onclick={() => onchange(range)}
			class={[
				'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
				value === range
					? 'bg-background text-foreground shadow-sm dark:bg-input/40'
					: 'text-muted-foreground hover:text-foreground'
			]}
		>
			{range}
		</button>
	{/each}
</fieldset>
