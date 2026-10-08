<script lang="ts">
import { Button } from '#lib/components/ui/button/index.js';
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();
</script>

<div class="min-h-screen bg-muted/40">
	<header class="border-b bg-background">
		<div class="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
			<a href="/projects" class="font-semibold tracking-tight">footprint</a>
			<nav class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
				{#each data.projects as project (project.id)}
					{@const active = page.params.id === project.id}
					<a
						href="/projects/{project.id}"
						class={[
							'whitespace-nowrap rounded-md px-2.5 py-1.5 hover:bg-accent',
							active ? 'bg-accent font-medium' : 'text-muted-foreground'
						]}
						aria-current={active ? 'page' : undefined}
					>
						{project.name}
					</a>
				{/each}
			</nav>
			<a
				href="/organizations"
				class={[
					'rounded-md px-2.5 py-1.5 text-sm hover:bg-accent',
					page.url.pathname.startsWith('/organizations')
						? 'bg-accent font-medium'
						: 'text-muted-foreground'
				]}
			>
				Team
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">{data.user.email}</span>
			<form method="POST" action="/logout">
				<Button type="submit" variant="ghost" size="sm">Sign out</Button>
			</form>
		</div>
	</header>
	<main class="mx-auto max-w-5xl px-4 py-8">{@render children()}</main>
</div>
