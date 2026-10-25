<script lang="ts">
import SubNav from '#lib/components/sub-nav.svelte';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const views = $derived([
	{ href: `/projects/${data.project.id}/web`, label: 'Overview' },
	{ href: `/projects/${data.project.id}/web/heatmaps`, label: 'Heatmaps' }
]);
</script>

<div class="grid gap-4">
	<div><SubNav links={views} label="Web analytics views" /></div>
	{@render children()}
</div>
