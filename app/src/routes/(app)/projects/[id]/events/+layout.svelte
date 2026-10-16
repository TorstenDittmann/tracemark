<script lang="ts">
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const views = $derived([
	{ href: `/projects/${data.project.id}/events`, label: 'Activity' },
	{ href: `/projects/${data.project.id}/events/definitions`, label: 'Event definitions' },
	{ href: `/projects/${data.project.id}/events/properties`, label: 'Properties' }
]);
</script>

<div class="grid gap-4">
	<nav class="flex gap-1 overflow-x-auto text-sm" aria-label="Event views">
		{#each views as view (view.href)}
			{@const active = page.url.pathname === view.href}
			<a
				href={view.href}
				class={[
					'rounded-md px-3 py-1.5 whitespace-nowrap',
					active ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground'
				]}
				aria-current={active ? 'page' : undefined}
			>
				{view.label}
			</a>
		{/each}
	</nav>
	{@render children()}
</div>
