<script lang="ts">
import Search from '@lucide/svelte/icons/search';
import AppSidebar from '#lib/components/shell/app-sidebar.svelte';
import CommandMenu from '#lib/components/shell/command-menu.svelte';
import ThemeToggle from '#lib/components/shell/theme-toggle.svelte';
import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
import { Kbd } from '#lib/components/ui/kbd/index.js';
import { Separator } from '#lib/components/ui/separator/index.js';
import * as Sidebar from '#lib/components/ui/sidebar/index.js';
import { activeNavItem } from '#lib/nav.js';
import { page } from '$app/state';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

let searchOpen = $state(false);
const projectId = $derived(page.params.id);
const project = $derived(data.projects.find((p) => p.id === projectId));
const section = $derived(projectId ? activeNavItem(projectId, page.url.pathname) : undefined);
const crumb = $derived(
	section?.label ??
		(page.url.pathname.startsWith('/organizations') ? 'Team' : project ? undefined : 'Projects')
);
</script>

<Sidebar.Provider open={data.sidebarOpen}>
	<AppSidebar projects={data.projects} {projectId} user={data.user} />
	<Sidebar.Inset class="min-w-0">
		<header
			class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md md:rounded-t-xl"
		>
			<Sidebar.Trigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-1 h-4 data-vertical:self-center" />
			<Breadcrumb.Root class="min-w-0">
				<Breadcrumb.List class="flex-nowrap">
					{#if project}
						<Breadcrumb.Item class="hidden min-w-0 sm:inline-flex">
							<Breadcrumb.Link href="/projects/{project.id}" class="truncate">
								{project.name}
							</Breadcrumb.Link>
						</Breadcrumb.Item>
						{#if crumb}
							<Breadcrumb.Separator class="hidden sm:block" />
						{/if}
					{/if}
					{#if crumb}
						<Breadcrumb.Item>
							<Breadcrumb.Page class="truncate">{crumb}</Breadcrumb.Page>
						</Breadcrumb.Item>
					{/if}
				</Breadcrumb.List>
			</Breadcrumb.Root>
			<div class="ml-auto flex items-center gap-1">
				<button
					type="button"
					onclick={() => (searchOpen = true)}
					class="group flex h-8 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-56"
				>
					<Search class="size-4" />
					<span class="hidden sm:inline">Search…</span>
					<Kbd class="ml-auto hidden sm:inline-flex">⌘K</Kbd>
				</button>
				<ThemeToggle />
			</div>
		</header>
		<main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">
			{#key page.url.pathname}
				<div class="animate-enter">{@render children()}</div>
			{/key}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<CommandMenu bind:open={searchOpen} projects={data.projects} {projectId} />
