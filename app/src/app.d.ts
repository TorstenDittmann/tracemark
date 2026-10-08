// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Auth } from '#lib/server/auth/index.js';

type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: AuthSession['user'] | null;
			session: AuthSession['session'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}
