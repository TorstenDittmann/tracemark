import type { Handle } from '@sveltejs/kit/hooks';
import { deleteSessionCookie, setSessionCookie } from '#lib/server/auth/cookie.js';
import { SESSION_COOKIE, validateSession } from '#lib/server/auth/session.js';
import { getDb } from '#lib/server/db/index.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = await validateSession(getDb(), token);
		if (session) {
			event.locals.user = session.user;
			if (session.renewed) setSessionCookie(event.cookies, event.url, token, session.expiresAt);
		} else {
			deleteSessionCookie(event.cookies, event.url);
		}
	}
	return resolve(event);
};
