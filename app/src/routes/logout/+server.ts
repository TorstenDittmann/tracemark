import { redirect } from '@sveltejs/kit';
import { deleteSessionCookie } from '#lib/server/auth/cookie.js';
import { invalidateSession, SESSION_COOKIE } from '#lib/server/auth/session.js';
import { getDb } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, url }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await invalidateSession(getDb(), token);
	deleteSessionCookie(cookies, url);
	redirect(303, '/login');
};
