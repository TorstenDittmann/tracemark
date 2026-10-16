import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { startRetentionSweeps } from '#lib/server/analytics.js';
import { getAuth } from '#lib/server/auth/instance.js';
import { building } from '$app/env';

export const init: ServerInit = () => {
	if (!building) startRetentionSweeps();
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	if (building) return resolve(event);

	const auth = getAuth();
	// Endpoints without a session cookie (health, ingest key polling) skip the lookup.
	if (event.request.headers.get('cookie')?.includes('session_token')) {
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (session) {
			event.locals.user = session.user;
			event.locals.session = session.session;
		}
	}
	return svelteKitHandler({ event, resolve, auth, building });
};
