import { error, fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { normalizeEmail } from '#lib/server/accounts.js';
import { INVITE_ROLES, type InviteRole } from '#lib/server/auth/index.js';
import { getAuth } from '#lib/server/auth/instance.js';
import { getDb } from '#lib/server/db/index.js';
import {
	getOrganizationForUser,
	invite,
	listMembers,
	listPendingInvitations
} from '#lib/server/members.js';
import { canManage } from '#lib/server/projects.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, '/login');
	const db = getDb();
	const row = await getOrganizationForUser(db, locals.user.id, params.id);
	if (!row) error(404, 'Organization not found');
	const manager = canManage(row.role);
	const [memberList, pending] = await Promise.all([
		listMembers(db, params.id),
		manager ? listPendingInvitations(db, params.id) : []
	]);
	return {
		organization: { id: row.organization.id, name: row.organization.name },
		role: row.role,
		members: memberList,
		invitations: pending.map((i) => ({ ...i, link: `${url.origin}/invite/${i.id}` }))
	};
};

/** Actions don't run load, so each one checks access itself; better-auth checks the role again. */
async function requireManager({ locals, params }: RequestEvent) {
	if (!locals.user) redirect(303, '/login');
	const row = await getOrganizationForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Organization not found');
	if (!canManage(row.role)) error(403, 'Only organization owners and admins can do this');
}

function apiFailure(action: string, err: unknown) {
	if (isAPIError(err)) return fail(400, { action, message: err.message });
	throw err;
}

export const actions: Actions = {
	invite: async (event) => {
		await requireManager(event);
		const form = await event.request.formData();
		const email = normalizeEmail(String(form.get('email') ?? ''));
		const role = String(form.get('role') ?? 'member') as InviteRole;
		if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
			return fail(400, { action: 'invite', message: 'Enter a valid email address.', email });
		}
		if (!INVITE_ROLES.includes(role)) {
			return fail(400, { action: 'invite', message: 'Pick a role.', email });
		}
		try {
			await invite(getAuth(), event.request.headers, {
				organizationId: event.params.id,
				email,
				role
			});
		} catch (err) {
			return apiFailure('invite', err);
		}
		return { action: 'invite', message: `Invitation created for ${email}. Send them the link.` };
	},

	cancel: async (event) => {
		await requireManager(event);
		const invitationId = String((await event.request.formData()).get('invitation') ?? '');
		try {
			await getAuth().api.cancelInvitation({
				body: { invitationId },
				headers: event.request.headers
			});
		} catch (err) {
			return apiFailure('cancel', err);
		}
		return { action: 'cancel', message: 'Invitation cancelled.' };
	},

	remove: async (event) => {
		await requireManager(event);
		const memberId = String((await event.request.formData()).get('member') ?? '');
		try {
			await getAuth().api.removeMember({
				body: { memberIdOrEmail: memberId, organizationId: event.params.id },
				headers: event.request.headers
			});
		} catch (err) {
			return apiFailure('remove', err);
		}
		return { action: 'remove', message: 'Member removed.' };
	}
};
