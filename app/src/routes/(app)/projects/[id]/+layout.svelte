<script lang="ts">
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const tabs = $derived([
	{ href: `/projects/${data.project.id}`, label: 'Overview' },
	{ href: `/projects/${data.project.id}/settings`, label: 'Settings' }
]);
</script>

<div class="grid gap-6">
	<div class="grid gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">{data.project.name}</h1>
		<nav class="flex gap-1 border-b text-sm">
			{#each tabs as tab (tab.href)}
				{@const active = page.url.pathname === tab.href}
				<a
					href={tab.href}
					class={[
						'-mb-px border-b-2 px-3 py-2',
						active
							? 'border-primary font-medium'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					]}
					aria-current={active ? 'page' : undefined}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>
	{@render children()}
</div>
