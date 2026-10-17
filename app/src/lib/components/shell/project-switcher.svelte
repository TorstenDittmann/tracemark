<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import Plus from '@lucide/svelte/icons/plus';
import Logo from '#lib/components/logo.svelte';
import ProjectAvatar from '#lib/components/project-avatar.svelte';
import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
import * as Sidebar from '#lib/components/ui/sidebar/index.js';
import { goto } from '$app/navigation';

let {
	projects,
	projectId
}: {
	projects: { id: string; name: string; organizationName: string }[];
	projectId?: string;
} = $props();

const sidebar = Sidebar.useSidebar();
const current = $derived(projects.find((p) => p.id === projectId));
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({
					props
				})}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						class="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
					>
						{#if current}
							<ProjectAvatar id={current.id} name={current.name} />
							<span class="grid flex-1 text-left leading-tight">
								<span class="truncate font-semibold">{current.name}</span>
								<span class="truncate text-xs text-muted-foreground"
									>{current.organizationName}</span
								>
							</span>
						{:else}
							<Logo />
							<span class="grid flex-1 text-left leading-tight">
								<span class="truncate font-semibold">Tracemark</span>
								<span class="truncate text-xs text-muted-foreground">Choose a project</span>
							</span>
						{/if}
						<ChevronsUpDown class="ml-auto text-muted-foreground" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-60"
				align="start"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				sideOffset={4}
			>
				<DropdownMenu.Group>
					<DropdownMenu.Label class="text-xs text-muted-foreground">Projects</DropdownMenu.Label>
					{#each projects as project (project.id)}
						<DropdownMenu.Item onSelect={() => goto(`/projects/${project.id}`)} class="gap-2 p-2">
							<ProjectAvatar
								id={project.id}
								name={project.name}
								class="size-6 rounded-md text-xs"
							/>
							<span class="grid flex-1 leading-tight">
								<span class="truncate">{project.name}</span>
								<span class="truncate text-xs text-muted-foreground"
									>{project.organizationName}</span
								>
							</span>
							{#if project.id === projectId}
								<Check class="text-primary" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => goto('/projects?new')} class="gap-2 p-2">
					<span class="flex size-6 items-center justify-center rounded-md border bg-background">
						<Plus class="size-4" />
					</span>
					<span class="font-medium text-muted-foreground">New project</span>
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
