<script lang="ts">
import RangePicker from '#lib/components/range-picker.svelte';
import SubNav from '#lib/components/sub-nav.svelte';
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
	<SubNav
		label="AI"
		links={links.map((link) => ({
			href: range ? `${link.href}?range=${range}` : link.href,
			label: link.label,
			active: current === link.key
		}))}
	/>
	{#if range}
		<RangePicker current={range} />
	{/if}
</div>
