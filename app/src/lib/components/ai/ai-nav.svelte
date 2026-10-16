<script lang="ts">
import RangePicker from '#lib/components/range-picker.svelte';
import type { Range } from '#lib/web.js';

let {
	projectId,
	current,
	range
}: { projectId: string; current: 'overview' | 'traces'; range?: Range } = $props();

const links = $derived([
	{ key: 'overview', label: 'Overview', href: `/projects/${projectId}/ai` },
	{ key: 'traces', label: 'Traces', href: `/projects/${projectId}/ai/traces` }
]);
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
	<nav class="flex gap-1 text-sm" aria-label="AI">
		{#each links as link (link.key)}
			<a
				href={range ? `${link.href}?range=${range}` : link.href}
				aria-current={current === link.key ? 'page' : undefined}
				class={[
					'rounded-md px-2.5 py-1',
					current === link.key
						? 'bg-secondary font-medium text-secondary-foreground'
						: 'text-muted-foreground hover:text-foreground'
				]}
			>
				{link.label}
			</a>
		{/each}
	</nav>
	{#if range}
		<RangePicker current={range} />
	{/if}
</div>
