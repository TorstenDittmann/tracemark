import type { Cookies } from '@sveltejs/kit';
import { SESSION_COOKIE } from './session';

/**
 * `secure` follows the request's protocol: SvelteKit's default only drops it for http://localhost,
 * which would stop sign-in on self-hosted instances served over plain HTTP on another host.
 */
export function setSessionCookie(cookies: Cookies, url: URL, token: string, expiresAt: Date) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax',
		expires: expiresAt
	});
}

export function deleteSessionCookie(cookies: Cookies, url: URL) {
	cookies.delete(SESSION_COOKIE, { path: '/', secure: url.protocol === 'https:' });
}
