<script lang="ts">
import SubNav from '#lib/components/sub-nav.svelte';
import { INSIGHT_EDITORS } from '#lib/insight-kinds.js';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const kinds = $derived([
	...INSIGHT_EDITORS.map(({ path, label }) => ({
		href: `/projects/${data.project.id}/insights/${path}`,
		label
	})),
	{ href: `/projects/${data.project.id}/insights/saved`, label: 'Saved' }
]);
</script>

<div class="grid gap-4">
	<div><SubNav links={kinds} label="Insight type" /></div>
	{@render children()}
</div>
