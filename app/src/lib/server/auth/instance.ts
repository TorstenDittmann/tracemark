import { sveltekitCookies } from 'better-auth/svelte-kit';
import { ALLOW_SIGNUP, AUTH_SECRET, PUBLIC_URL } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { getDb } from '../db/index';
import { type Auth, createAuth } from './index';

/** ALLOW_SIGNUP=on lets anyone create an account with their own organization. */
export function signUpAllowed(): boolean {
	return ALLOW_SIGNUP === 'on';
}

let instance: Auth | undefined;

/** The app's better-auth instance, created on first use so builds never touch the database. */
export function getAuth(): Auth {
	instance ??= createAuth(getDb(), {
		baseURL: PUBLIC_URL,
		secret: AUTH_SECRET,
		allowSignUp: signUpAllowed(),
		plugins: [sveltekitCookies(getRequestEvent)]
	});
	return instance;
}
