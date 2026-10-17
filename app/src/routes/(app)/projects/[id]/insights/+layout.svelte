<script lang="ts">
import SubNav from '#lib/components/sub-nav.svelte';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const kinds = $derived([
	{ href: `/projects/${data.project.id}/insights/trends`, label: 'Trends' },
	{ href: `/projects/${data.project.id}/insights/funnels`, label: 'Funnels' },
	{ href: `/projects/${data.project.id}/insights/retention`, label: 'Retention' },
	{ href: `/projects/${data.project.id}/insights/saved`, label: 'Saved' }
]);
</script>

<div class="grid gap-4">
	<div><SubNav links={kinds} label="Insight type" /></div>
	{@render children()}
</div>
