<script lang="ts">
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const kinds = $derived([{ href: `/projects/${data.project.id}/insights/trends`, label: 'Trends' }]);
</script>

<div class="grid gap-4">
	<nav class="flex gap-1 text-sm" aria-label="Insight type">
		{#each kinds as kind (kind.href)}
			{@const active = page.url.pathname === kind.href}
			<a
				href={kind.href}
				class={[
					'rounded-md px-3 py-1.5',
					active ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground'
				]}
				aria-current={active ? 'page' : undefined}
			>
				{kind.label}
			</a>
		{/each}
	</nav>
	{@render children()}
</div>
