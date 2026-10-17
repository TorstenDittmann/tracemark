<script lang="ts">
import SubNav from '#lib/components/sub-nav.svelte';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const views = $derived([
	{ href: `/projects/${data.project.id}/events`, label: 'Activity' },
	{ href: `/projects/${data.project.id}/events/definitions`, label: 'Event definitions' },
	{ href: `/projects/${data.project.id}/events/properties`, label: 'Properties' }
]);
</script>

<div class="grid gap-4">
	<div><SubNav links={views} label="Event views" /></div>
	{@render children()}
</div>
