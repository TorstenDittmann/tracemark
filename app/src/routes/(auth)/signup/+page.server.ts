import { fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { hasUsers, readAccountForm, signUpWithOrganization } from '#lib/server/accounts.js';
import { MIN_PASSWORD_LENGTH } from '#lib/server/auth/index.js';
import { getAuth, signUpAllowed } from '#lib/server/auth/instance.js';
import { RateLimiter } from '#lib/server/auth/rate-limit.js';
import { getDb } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

const byAddress = new RateLimiter(10, 15 * 60 * 1000);

// Open only with ALLOW_SIGNUP=on, and only once setup has made the owner.
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/projects');
	if (!(await hasUsers(getDb()))) redirect(303, '/setup');
	if (!signUpAllowed()) redirect(303, '/login');
	return { minPasswordLength: MIN_PASSWORD_LENGTH };
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		if (!signUpAllowed()) redirect(303, '/login');
		const { input, values, errors } = readAccountForm(await request.formData());
		if (Object.keys(errors).length) return fail(400, { values, errors });
		if (!byAddress.consume(getClientAddress())) {
			return fail(429, {
				values,
				errors: { email: 'Too many attempts. Try again in a few minutes.' } as Record<
					string,
					string
				>
			});
		}

		try {
			// The SvelteKit cookie plugin sets the session cookie.
			await signUpWithOrganization(getAuth(), getDb(), input, request.headers);
		} catch (err) {
			if (isAPIError(err)) {
				return fail(400, { values, errors: { email: err.message } as Record<string, string> });
			}
			throw err;
		}
		redirect(303, '/projects');
	}
};
