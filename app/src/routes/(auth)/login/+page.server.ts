import { fail, redirect } from '@sveltejs/kit';
import { authenticate, hasUsers, normalizeEmail } from '#lib/server/accounts.js';
import { setSessionCookie } from '#lib/server/auth/cookie.js';
import { RateLimiter } from '#lib/server/auth/rate-limit.js';
import { createSession } from '#lib/server/auth/session.js';
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
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const email = normalizeEmail(String(form.get('email') ?? ''));
		const password = String(form.get('password') ?? '');

		if (!byAddress.consume(getClientAddress()) || !byEmail.consume(email)) {
			return fail(429, { email, message: 'Too many attempts. Try again in a few minutes.' });
		}

		const db = getDb();
		const user = await authenticate(db, email, password);
		if (!user) return fail(400, { email, message: 'Wrong email or password.' });

		byEmail.reset(email);
		const session = await createSession(db, user.id);
		setSessionCookie(cookies, url, session.token, session.expiresAt);
		redirect(303, safeRedirectPath(url.searchParams.get('next')));
	}
};
