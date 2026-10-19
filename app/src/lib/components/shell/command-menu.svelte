<script lang="ts">
import ChartNoAxesColumn from '@lucide/svelte/icons/chart-no-axes-column';
import Plus from '@lucide/svelte/icons/plus';
import SunMoon from '@lucide/svelte/icons/sun-moon';
import UsersRound from '@lucide/svelte/icons/users-round';
import { toggleMode } from 'mode-watcher';
import ProjectAvatar from '#lib/components/project-avatar.svelte';
import * as Command from '#lib/components/ui/command/index.js';
import { INSIGHT_EDITORS } from '#lib/insight-kinds.js';
import { ALERTS_NAV, PROJECT_NAV, SETTINGS_NAV } from '#lib/nav.js';
import { goto } from '$app/navigation';

let {
	open = $bindable(false),
	projects,
	projectId
}: {
	open?: boolean;
	projects: { id: string; name: string; organizationName: string }[];
	projectId?: string;
} = $props();

const project = $derived(projects.find((p) => p.id === projectId));

function run(action: () => unknown) {
	open = false;
	action();
}

function onkeydown(event: KeyboardEvent) {
	if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
		event.preventDefault();
		open = !open;
	}
}
</script>

<svelte:window {onkeydown} />

<Command.Dialog bind:open title="Search" description="Jump to a page, project or action">
	<Command.Input placeholder="Search pages, projects and actions…" />
	<Command.List>
		<Command.Empty>Nothing matches that.</Command.Empty>
		{#if project}
			{#each PROJECT_NAV as group (group.label)}
				<Command.Group heading={group.label}>
					{#each group.items as item (item.path)}
						<Command.Item
							value="{project.name} {item.label}"
							keywords={[item.description]}
							onSelect={() => run(() => goto(`/projects/${project.id}${item.path}`))}
						>
							<item.icon />
							{item.label}
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
			<Command.Group heading="Insights">
				{#each INSIGHT_EDITORS as editor (editor.path)}
					<Command.Item
						value="{project.name} insight {editor.label}"
						keywords={[editor.description]}
						onSelect={() => run(() => goto(`/projects/${project.id}/insights/${editor.path}`))}
					>
						<ChartNoAxesColumn />
						{editor.label}
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}
		<Command.Group heading="Projects">
			{#each projects as p (p.id)}
				<Command.Item
					value="project {p.name} {p.organizationName}"
					onSelect={() => run(() => goto(`/projects/${p.id}`))}
				>
					<ProjectAvatar id={p.id} name={p.name} class="size-5 rounded-md text-[10px]" />
					{p.name}
					<span class="ml-auto text-xs text-muted-foreground">{p.organizationName}</span>
				</Command.Item>
			{/each}
		</Command.Group>
		<Command.Separator />
		<Command.Group heading="Actions">
			<Command.Item value="new project create" onSelect={() => run(() => goto('/projects?new'))}>
				<Plus />
				New project
			</Command.Item>
			{#if project}
				<Command.Item
					value="{project.name} {SETTINGS_NAV.label}"
					onSelect={() => run(() => goto(`/projects/${project.id}${SETTINGS_NAV.path}`))}
				>
					<SETTINGS_NAV.icon />
					Project settings
				</Command.Item>
				<Command.Item
					value="{project.name} {ALERTS_NAV.label} webhooks notifications"
					keywords={[ALERTS_NAV.description]}
					onSelect={() => run(() => goto(`/projects/${project.id}${ALERTS_NAV.path}`))}
				>
					<ALERTS_NAV.icon />
					Alerts
				</Command.Item>
			{/if}
			<Command.Item
				value="team invite members organization"
				onSelect={() => run(() => goto('/organizations'))}
			>
				<UsersRound />
				Team and invites
			</Command.Item>
			<Command.Item value="toggle theme dark light mode" onSelect={() => run(toggleMode)}>
				<SunMoon />
				Toggle theme
			</Command.Item>
		</Command.Group>
	</Command.List>
</Command.Dialog>
