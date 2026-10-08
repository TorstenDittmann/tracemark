import { error, fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { MIN_PASSWORD_LENGTH } from '#lib/server/auth/index.js';
import { getAuth } from '#lib/server/auth/instance.js';
import { getDb } from '#lib/server/db/index.js';
import {
	acceptInvitation,
	getOpenInvitation,
	hasAccount,
	joinWithInvitation
} from '#lib/server/members.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const db = getDb();
	const invitation = await getOpenInvitation(db, params.id);
	if (!invitation) error(404, 'This invitation was used, cancelled or has expired.');
	return {
		invitation: {
			email: invitation.email,
			role: invitation.role,
			organizationName: invitation.organizationName,
			inviterName: invitation.inviterName
		},
		signedInAs: locals.user?.email ?? null,
		hasAccount: await hasAccount(db, invitation.email)
	};
};

export const actions: Actions = {
	/** Signed-in user accepts. better-auth checks the invitation is addressed to them. */
	accept: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, `/login?next=/invite/${params.id}`);
		const invitation = await getOpenInvitation(getDb(), params.id);
		if (!invitation) error(404, 'This invitation was used, cancelled or has expired.');
		try {
			await acceptInvitation(getAuth(), request.headers, params.id);
		} catch (err) {
			if (isAPIError(err)) return fail(400, { message: err.message });
			throw err;
		}
		redirect(303, `/organizations/${invitation.organizationId}`);
	},

	/** New user creates an account for the invited email; the cookie plugin signs them in. */
	join: async ({ request, params }) => {
		const db = getDb();
		const invitation = await getOpenInvitation(db, params.id);
		if (!invitation) error(404, 'This invitation was used, cancelled or has expired.');
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!name) return fail(400, { name, message: 'Enter your name.' });
		if (password.length < MIN_PASSWORD_LENGTH || password.length > 256) {
			return fail(400, {
				name,
				message: `Use between ${MIN_PASSWORD_LENGTH} and 256 characters for your password.`
			});
		}
		if (await hasAccount(db, invitation.email)) {
			return fail(400, { name, message: 'This email already has an account. Sign in to accept.' });
		}
		try {
			await joinWithInvitation(getAuth(), invitation, { name, password }, request.headers);
		} catch (err) {
			if (isAPIError(err)) return fail(400, { name, message: err.message });
			throw err;
		}
		redirect(303, `/organizations/${invitation.organizationId}`);
	}
};
