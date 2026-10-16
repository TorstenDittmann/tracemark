<script lang="ts">
import { page } from '$app/state';

let { projectId }: { projectId: string } = $props();

const views = $derived([
	{ href: `/projects/${projectId}/persons`, label: 'People' },
	{ href: `/projects/${projectId}/cohorts`, label: 'Cohorts' }
]);
</script>

<nav class="flex gap-1 overflow-x-auto text-sm" aria-label="People views">
	{#each views as view (view.href)}
		{@const active = page.url.pathname.startsWith(view.href)}
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
