<script lang="ts">
import SubNav from '#lib/components/sub-nav.svelte';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const views = $derived([
	{ href: `/organizations/${data.organization.id}`, label: 'Team' },
	{ href: `/organizations/${data.organization.id}/usage`, label: 'Usage' }
]);
</script>

<div class="grid gap-4">
	<div><SubNav links={views} label="Organization views" /></div>
	{@render children()}
</div>
