import { fail, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { hasUsers, normalizeEmail } from '#lib/server/accounts.js';
import { getAuth } from '#lib/server/auth/instance.js';
import { RateLimiter } from '#lib/server/auth/rate-limit.js';
import { getDb } from '#lib/server/db/index.js';
import { safeRedirectPath } from '#lib/server/redirect.js';
import type { Actions, PageServerLoad } from './$types';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const byAddress = new RateLimiter(30, FIFTEEN_MINUTES);
const byEmail = new RateLimiter(10, FIFTEEN_MINUTES);

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeRedirectPath(url.searchParams.get('next')));
	if (!(await hasUsers(getDb()))) redirect(303, '/setup');
};

export const actions: Actions = {
	default: async ({ request, url, getClientAddress }) => {
		const form = await request.formData();
		const email = normalizeEmail(String(form.get('email') ?? ''));
		const password = String(form.get('password') ?? '');

		if (!byAddress.consume(getClientAddress()) || !byEmail.consume(email)) {
			return fail(429, { email, message: 'Too many attempts. Try again in a few minutes.' });
		}

		try {
			// The SvelteKit cookie plugin sets the session cookie.
			await getAuth().api.signInEmail({ body: { email, password }, headers: request.headers });
		} catch (err) {
			if (isAPIError(err)) return fail(400, { email, message: 'Wrong email or password.' });
			throw err;
		}
		byEmail.reset(email);
		redirect(303, safeRedirectPath(url.searchParams.get('next')));
	}
};
