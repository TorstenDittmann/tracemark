import { fail, redirect } from '@sveltejs/kit';
import { hasUsers, setupFirstUser, validateCredentials } from '#lib/server/accounts.js';
import { setSessionCookie } from '#lib/server/auth/cookie.js';
import { createSession } from '#lib/server/auth/session.js';
import { getDb } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

// Setup is only open while the instance has no users; the first person to finish it becomes the owner.
export const load: PageServerLoad = async () => {
	if (await hasUsers(getDb())) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const input = {
			name: String(form.get('name') ?? '').trim(),
			email: String(form.get('email') ?? '').trim(),
			password: String(form.get('password') ?? ''),
			organization: String(form.get('organization') ?? '').trim()
		};
		const values = { name: input.name, email: input.email, organization: input.organization };

		const errors: Record<string, string> = validateCredentials(input) ?? {};
		if (!input.name) errors.name = 'Enter your name.';
		if (!input.organization) errors.organization = 'Enter an organization name.';
		if (Object.keys(errors).length) return fail(400, { values, errors });

		const db = getDb();
		const user = await setupFirstUser(db, input);
		if (!user) redirect(303, '/login');

		const session = await createSession(db, user.id);
		setSessionCookie(cookies, url, session.token, session.expiresAt);
		redirect(303, '/projects');
	}
};
