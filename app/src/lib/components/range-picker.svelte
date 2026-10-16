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

<fieldset class="inline-flex rounded-md border p-0.5 text-sm">
	<legend class="sr-only">Date range</legend>
	{#each ranges as range (range)}
		<a
			href={href(range)}
			title={RANGES[range].label}
			aria-current={current === range ? 'true' : undefined}
			class={[
				'rounded px-2.5 py-1',
				current === range
					? 'bg-secondary font-medium text-secondary-foreground'
					: 'text-muted-foreground hover:text-foreground'
			]}
		>
			{range}
		</a>
	{/each}
</fieldset>
