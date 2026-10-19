<script lang="ts">
import FolderKanban from '@lucide/svelte/icons/folder-kanban';
import UsersRound from '@lucide/svelte/icons/users-round';
import * as Sidebar from '#lib/components/ui/sidebar/index.js';
import { activeNavItem, FOOTER_NAV, PROJECT_NAV } from '#lib/nav.js';
import { page } from '$app/state';
import ProjectSwitcher from './project-switcher.svelte';
import UserMenu from './user-menu.svelte';

let {
	projects,
	projectId,
	user
}: {
	projects: { id: string; name: string; organizationName: string }[];
	projectId?: string;
	user: { name: string; email: string };
} = $props();

const sidebar = Sidebar.useSidebar();
const active = $derived(projectId ? activeNavItem(projectId, page.url.pathname) : undefined);
const workspace = [
	{ href: '/projects', label: 'Projects', icon: FolderKanban },
	{ href: '/organizations', label: 'Team', icon: UsersRound }
];

// Close the mobile drawer after picking a page.
function closeMobile() {
	if (sidebar.isMobile) sidebar.setOpenMobile(false);
}
</script>

<Sidebar.Root collapsible="icon" variant="inset">
	<Sidebar.Header>
		<ProjectSwitcher {projects} {projectId} />
	</Sidebar.Header>
	<Sidebar.Content>
		{#if projectId}
			{#each PROJECT_NAV as group (group.label)}
				<Sidebar.Group>
					<Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
					<Sidebar.Menu>
						{#each group.items as item (item.path)}
							{@const isActive = active === item}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton {isActive} tooltipContent={item.label}>
									{#snippet child({
										props
									})}
										<a
											href="/projects/{projectId}{item.path}"
											aria-current={isActive ? 'page' : undefined}
											onclick={closeMobile}
											{...props}
										>
											<item.icon
												class={[
													'transition-colors',
													isActive ? 'text-primary' : 'text-muted-foreground'
												]}
											/>
											<span>{item.label}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.Group>
			{/each}
		{:else}
			<Sidebar.Group>
				<Sidebar.GroupLabel>Workspace</Sidebar.GroupLabel>
				<Sidebar.Menu>
					{#each workspace as item (item.href)}
						{@const isActive = page.url.pathname.startsWith(item.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton {isActive} tooltipContent={item.label}>
								{#snippet child({
									props
								})}
									<a href={item.href} onclick={closeMobile} {...props}>
										<item.icon />
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.Group>
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer>
		{#if projectId}
			<Sidebar.Menu>
				{#each FOOTER_NAV as item (item.path)}
					{@const isActive = active === item}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton {isActive} tooltipContent={item.label}>
							{#snippet child({
								props
							})}
								<a
									href="/projects/{projectId}{item.path}"
									aria-current={isActive ? 'page' : undefined}
									onclick={closeMobile}
									{...props}
								>
									<item.icon class={isActive ? 'text-primary' : 'text-muted-foreground'} />
									<span>{item.label}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		{/if}
		<UserMenu {user} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
