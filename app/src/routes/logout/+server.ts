import { redirect } from '@sveltejs/kit';
import { getAuth } from '#lib/server/auth/instance.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	// The SvelteKit cookie plugin clears the session cookie.
	if (locals.session) await getAuth().api.signOut({ headers: request.headers });
	redirect(303, '/login');
};
