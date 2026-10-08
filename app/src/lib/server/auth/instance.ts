import { sveltekitCookies } from 'better-auth/svelte-kit';
import { AUTH_SECRET, PUBLIC_URL } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { getDb } from '../db/index';
import { type Auth, createAuth } from './index';

let instance: Auth | undefined;

/** The app's better-auth instance, created on first use so builds never touch the database. */
export function getAuth(): Auth {
	instance ??= createAuth(getDb(), {
		baseURL: PUBLIC_URL,
		secret: AUTH_SECRET,
		plugins: [sveltekitCookies(getRequestEvent)]
	});
	return instance;
}
