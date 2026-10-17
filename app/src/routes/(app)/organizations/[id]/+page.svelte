<script lang="ts">
import UsersRound from '@lucide/svelte/icons/users-round';
import { selectClass } from '#lib/components/insights/editor.svelte.js';
import PageHeader from '#lib/components/page-header.svelte';
import StatusPill from '#lib/components/status-pill.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import * as Card from '#lib/components/ui/card/index.js';
import { Input } from '#lib/components/ui/input/index.js';
import { Label } from '#lib/components/ui/label/index.js';
import { enhance } from '$app/forms';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
let copied = $state<string | null>(null);

const manager = $derived(data.role === 'owner' || data.role === 'admin');
const messageFor = (action: string) => (form?.action === action ? form.message : null);

const initials = (name: string) =>
	name
		.split(/[\s@.]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join('');

const formatDate = (date: Date) => date.toLocaleDateString(undefined, { dateStyle: 'medium' });

async function copy(id: string, link: string) {
	await navigator.clipboard.writeText(link);
	copied = id;
	setTimeout(() => {
		if (copied === id) copied = null;
	}, 1500);
}
</script>

<svelte:head>
	<title>Team · {data.organization.name} · Tracemark</title>
</svelte:head>

<div class="grid gap-6">
	<PageHeader
		title={data.organization.name}
		description="Everyone here can see all of this organization's projects."
		icon={UsersRound}
	/>

	<Card.Root>
		<Card.Header>
			<Card.Title>Members</Card.Title>
		</Card.Header>
		<Card.Content>
			<ul class="divide-y">
				{#each data.members as member (member.id)}
					<li class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
						<span
							class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
							aria-hidden="true"
						>
							{initials(member.name || member.email)}
						</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{member.name}</p>
							<p class="truncate text-sm text-muted-foreground">{member.email}</p>
						</div>
						<StatusPill tone={member.role === 'owner' ? 'primary' : 'muted'} class="capitalize">
							{member.role}
						</StatusPill>
						{#if manager && member.userId !== data.user.id && member.role !== 'owner'}
							<form
								method="POST"
								action="?/remove"
								use:enhance={({ cancel }) => {
									if (!confirm(`Remove ${member.name} from ${data.organization.name}?`)) cancel();
								}}
							>
								<input type="hidden" name="member" value={member.id}>
								<Button type="submit" variant="ghost" size="sm">Remove</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			{#if messageFor('remove')}
				<p class="mt-2 text-sm text-muted-foreground" role="status">{messageFor('remove')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if manager}
		<Card.Root>
			<Card.Header>
				<Card.Title>Invite someone</Card.Title>
				<Card.Description>
					Tracemark doesn't send email. Create an invitation, then send the person its link. Links
					work for 7 days.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<form
					method="POST"
					action="?/invite"
					class="flex flex-col gap-4 sm:flex-row sm:items-end"
					use:enhance
				>
					<div class="grid flex-1 gap-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							required
							placeholder="grace@example.com"
							value={form?.action === 'invite' && 'email' in form ? form.email : ''}
						/>
					</div>
					<div class="grid gap-2">
						<Label for="role">Role</Label>
						<select id="role" name="role" class={[selectClass, 'h-9']}>
							<option value="member">Member</option>
							<option value="admin">Admin</option>
						</select>
					</div>
					<Button type="submit">Create invitation</Button>
				</form>
				{#if messageFor('invite') || messageFor('cancel')}
					<p class="text-sm text-muted-foreground" role="status">
						{messageFor('invite') ?? messageFor('cancel')}
					</p>
				{/if}
				<p class="text-sm text-muted-foreground">
					Admins can invite people, rotate keys and delete projects. Members can view and rename
					projects.
				</p>
			</Card.Content>
		</Card.Root>

		{#if data.invitations.length}
			<Card.Root>
				<Card.Header>
					<Card.Title>Pending invitations</Card.Title>
				</Card.Header>
				<Card.Content>
					<ul class="divide-y">
						{#each data.invitations as invitation (invitation.id)}
							<li class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{invitation.email}</p>
									<p class="text-sm text-muted-foreground">
										<span class="capitalize">{invitation.role}</span>
										· expires {formatDate(invitation.expiresAt)}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onclick={() => copy(invitation.id, invitation.link)}
								>
									{copied === invitation.id ? 'Copied' : 'Copy link'}
								</Button>
								<form method="POST" action="?/cancel" use:enhance>
									<input type="hidden" name="invitation" value={invitation.id}>
									<Button type="submit" variant="ghost" size="sm">Cancel</Button>
								</form>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
