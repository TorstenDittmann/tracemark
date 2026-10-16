<script lang="ts">
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const tabs: { href: string; label: string; also?: string }[] = $derived([
	{ href: `/projects/${data.project.id}`, label: 'Overview' },
	{ href: `/projects/${data.project.id}/web`, label: 'Web analytics' },
	{ href: `/projects/${data.project.id}/events`, label: 'Events' },
	{
		href: `/projects/${data.project.id}/persons`,
		label: 'People',
		also: `/projects/${data.project.id}/cohorts`
	},
	{ href: `/projects/${data.project.id}/groups`, label: 'Groups' },
	{ href: `/projects/${data.project.id}/insights`, label: 'Insights' },
	{ href: `/projects/${data.project.id}/dashboards`, label: 'Dashboards' },
	{ href: `/projects/${data.project.id}/flags`, label: 'Feature flags' },
	{ href: `/projects/${data.project.id}/settings`, label: 'Settings' }
]);
</script>

<div class="grid gap-6">
	<div class="grid gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">{data.project.name}</h1>
		<nav class="flex gap-1 overflow-x-auto text-sm shadow-[inset_0_-1px_0_var(--border)]">
			{#each tabs as tab (tab.href)}
				{@const active =
					tab.href === `/projects/${data.project.id}`
						? page.url.pathname === tab.href
						: page.url.pathname.startsWith(tab.href) ||
							(tab.also !== undefined && page.url.pathname.startsWith(tab.also))}
				<a
					href={tab.href}
					class={[
						'border-b-2 px-3 py-2 whitespace-nowrap',
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
