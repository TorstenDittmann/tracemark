import { fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { hasUsers, readAccountForm, setupFirstUser } from '#lib/server/accounts.js';
import { MIN_PASSWORD_LENGTH } from '#lib/server/auth/index.js';
import { getAuth } from '#lib/server/auth/instance.js';
import { getDb } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

// Setup is only open while the instance has no users; the first person to finish it becomes the owner.
export const load: PageServerLoad = async () => {
	if (await hasUsers(getDb())) redirect(303, '/login');
	return { minPasswordLength: MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const { input, values, errors } = readAccountForm(await request.formData());
		if (Object.keys(errors).length) return fail(400, { values, errors });

		let user: Awaited<ReturnType<typeof setupFirstUser>>;
		try {
			// The SvelteKit cookie plugin sets the session cookie.
			user = await setupFirstUser(getAuth(), getDb(), input, request.headers);
		} catch (err) {
			if (isAPIError(err)) {
				return fail(400, { values, errors: { email: err.message } as Record<string, string> });
			}
			throw err;
		}
		redirect(303, user ? '/projects' : '/login');
	}
};
