import { and, asc, eq, gt } from 'drizzle-orm';
import type { Auth, InviteRole } from './auth/index';
import type { Db } from './db/client';
import { invitations, members, organizations, users } from './db/schema';

export async function getOrganizationForUser(db: Db, userId: string, organizationId: string) {
	const [row] = await db
		.select({ organization: organizations, role: members.role })
		.from(members)
		.innerJoin(organizations, eq(members.organizationId, organizations.id))
		.where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)));
	return row ?? null;
}

export async function listMembers(db: Db, organizationId: string) {
	return db
		.select({
			id: members.id,
			userId: users.id,
			name: users.name,
			email: users.email,
			role: members.role,
			createdAt: members.createdAt
		})
		.from(members)
		.innerJoin(users, eq(members.userId, users.id))
		.where(eq(members.organizationId, organizationId))
		.orderBy(asc(users.name));
}

export async function listPendingInvitations(db: Db, organizationId: string, now = new Date()) {
	return db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			expiresAt: invitations.expiresAt
		})
		.from(invitations)
		.where(
			and(
				eq(invitations.organizationId, organizationId),
				eq(invitations.status, 'pending'),
				gt(invitations.expiresAt, now)
			)
		)
		.orderBy(asc(invitations.email));
}

/** What the invite page shows. Null when the invitation is unknown, used, cancelled or expired. */
export async function getOpenInvitation(db: Db, invitationId: string, now = new Date()) {
	const [row] = await db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			organizationId: organizations.id,
			organizationName: organizations.name,
			inviterName: users.name
		})
		.from(invitations)
		.innerJoin(organizations, eq(invitations.organizationId, organizations.id))
		.innerJoin(users, eq(invitations.inviterId, users.id))
		.where(
			and(
				eq(invitations.id, invitationId),
				eq(invitations.status, 'pending'),
				gt(invitations.expiresAt, now)
			)
		);
	return row ?? null;
}

export async function hasAccount(db: Db, email: string): Promise<boolean> {
	const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	return !!row;
}

/** Invites by email; better-auth checks that the caller may invite to the organization. */
export function invite(
	auth: Auth,
	headers: Headers,
	input: { organizationId: string; email: string; role: InviteRole }
) {
	return auth.api.createInvitation({
		body: { organizationId: input.organizationId, email: input.email, role: input.role },
		headers
	});
}

/** Accepts an invitation for the signed-in user (identified by `headers`). */
export function acceptInvitation(auth: Auth, headers: Headers, invitationId: string) {
	return auth.api.acceptInvitation({ body: { invitationId }, headers });
}

/**
 * Creates an account for an invited email and accepts the invitation with it.
 * Returns the response headers, whose Set-Cookie signs the new user in.
 */
export async function joinWithInvitation(
	auth: Auth,
	invitation: { id: string; email: string },
	input: { name: string; password: string },
	headers: Headers = new Headers()
): Promise<Headers> {
	const { headers: responseHeaders } = await auth.api.signUpEmail({
		body: { name: input.name, email: invitation.email, password: input.password },
		headers,
		returnHeaders: true
	});
	const cookie = responseHeaders
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	await acceptInvitation(auth, new Headers({ cookie }), invitation.id);
	return responseHeaders;
}
