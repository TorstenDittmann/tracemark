<script lang="ts">
import PageHeader from '#lib/components/page-header.svelte';
import { activeNavItem } from '#lib/nav.js';
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const section = $derived(activeNavItem(data.project.id, page.url.pathname));
</script>

<div class="grid gap-6">
	{#if section}
		<PageHeader
			title={section.path === '' ? data.project.name : section.label}
			description={section.description}
			icon={section.icon}
		/>
	{/if}
	{@render children()}
</div>
