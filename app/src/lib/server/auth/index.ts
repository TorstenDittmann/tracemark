import { APIError, type BetterAuthPlugin, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { and, count, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client';
import * as schema from '../db/schema';

export const MIN_PASSWORD_LENGTH = 10;
const DAY = 24 * 60 * 60;

export const INVITE_ROLES = ['member', 'admin'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export interface AuthConfig {
	/** Public URL of the instance; decides cookie security and trusted origins. Inferred per request when unset. */
	baseURL?: string;
	secret?: string;
	/** Lets anyone create an account, not only the first user and invited people. */
	allowSignUp?: boolean;
	/** Framework glue, such as SvelteKit's cookie plugin. */
	plugins?: BetterAuthPlugin[];
}

/**
 * Sign-up is open for the instance's first user and, later, for people with a pending, unexpired invitation,
 * or for everyone when the instance allows open sign-up.
 */
async function canSignUp(db: Db, email: string, allowSignUp: boolean): Promise<boolean> {
	if (allowSignUp) return true;
	const [row] = await db.select({ n: count() }).from(schema.users);
	if ((row?.n ?? 0) === 0) return true;
	const [invite] = await db
		.select({ id: schema.invitations.id })
		.from(schema.invitations)
		.where(
			and(
				eq(schema.invitations.email, email.toLowerCase()),
				eq(schema.invitations.status, 'pending'),
				gt(schema.invitations.expiresAt, new Date())
			)
		)
		.limit(1);
	return !!invite;
}

export function createAuth(db: Db, config: AuthConfig = {}) {
	return betterAuth({
		appName: 'tracemark',
		baseURL: config.baseURL || undefined,
		secret: config.secret || undefined,
		database: drizzleAdapter(db, { provider: 'sqlite', usePlural: true, schema }),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			maxPasswordLength: 256
		},
		session: { expiresIn: 30 * DAY, updateAge: DAY },
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						if (!(await canSignUp(db, user.email, config.allowSignUp ?? false))) {
							throw new APIError('FORBIDDEN', { message: 'Sign-up is closed on this instance.' });
						}
					}
				}
			}
		},
		advanced: { database: { generateId: 'uuid' } },
		telemetry: { enabled: false },
		// cookie plugins must come last
		plugins: [
			organization({
				invitationExpiresIn: 7 * DAY,
				cancelPendingInvitationsOnReInvite: true,
				// There is no email delivery: the invite link itself proves the address.
				requireEmailVerificationOnInvitation: false
			}),
			...(config.plugins ?? [])
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;
