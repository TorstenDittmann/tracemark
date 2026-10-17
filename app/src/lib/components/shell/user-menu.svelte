<script lang="ts">
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import LogOut from '@lucide/svelte/icons/log-out';
import Monitor from '@lucide/svelte/icons/monitor';
import Moon from '@lucide/svelte/icons/moon';
import Sun from '@lucide/svelte/icons/sun';
import UsersRound from '@lucide/svelte/icons/users-round';
import { setMode, userPrefersMode } from 'mode-watcher';
import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
import * as Sidebar from '#lib/components/ui/sidebar/index.js';
import { goto } from '$app/navigation';

let { user }: { user: { name: string; email: string } } = $props();

const sidebar = Sidebar.useSidebar();
let logout = $state<HTMLFormElement>();

const initials = $derived(
	(user.name || user.email)
		.split(/[\s@.]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join('')
);
</script>

<form method="POST" action="/logout" bind:this={logout} class="hidden"></form>

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
						<span
							class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary text-xs font-semibold text-primary-foreground"
						>
							{initials}
						</span>
						<span class="grid flex-1 text-left leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs text-muted-foreground">{user.email}</span>
						</span>
						<ChevronsUpDown class="ml-auto text-muted-foreground" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<DropdownMenu.Label class="font-normal">
					<div class="grid leading-tight">
						<span class="truncate font-medium">{user.name}</span>
						<span class="truncate text-xs text-muted-foreground">{user.email}</span>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => goto('/organizations')}>
					<UsersRound />
					Team and invites
				</DropdownMenu.Item>
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger>
						<Sun />
						Theme
					</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
						<DropdownMenu.RadioGroup
							value={userPrefersMode.current}
							onValueChange={(mode) => setMode(mode as 'light' | 'dark' | 'system')}
						>
							<DropdownMenu.RadioItem value="light"><Sun /> Light</DropdownMenu.RadioItem>
							<DropdownMenu.RadioItem value="dark"><Moon /> Dark</DropdownMenu.RadioItem>
							<DropdownMenu.RadioItem value="system"><Monitor /> System</DropdownMenu.RadioItem>
						</DropdownMenu.RadioGroup>
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => logout?.requestSubmit()}>
					<LogOut />
					Sign out
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
