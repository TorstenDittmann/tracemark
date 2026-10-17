<script lang="ts">
import { RANGES, type Range } from '#lib/web.js';
import { page } from '$app/state';

let { current }: { current: Range } = $props();

const ranges = Object.keys(RANGES) as Range[];

function href(range: Range): string {
	const url = new URL(page.url.href);
	url.searchParams.set('range', range);
	return `${url.pathname}${url.search}`;
}
</script>

<fieldset class="inline-flex rounded-lg bg-muted p-0.5 text-sm">
	<legend class="sr-only">Date range</legend>
	{#each ranges as range (range)}
		<a
			href={href(range)}
			title={RANGES[range].label}
			aria-current={current === range ? 'true' : undefined}
			class={[
				'rounded-md px-2.5 py-1 font-medium transition-all duration-200',
				current === range
					? 'bg-background text-foreground shadow-sm dark:bg-input/40'
					: 'text-muted-foreground hover:text-foreground'
			]}
		>
			{range}
		</a>
	{/each}
</fieldset>
