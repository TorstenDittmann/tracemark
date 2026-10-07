import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { memberships, organizations, projects } from './db/schema';
import { generatePublicKey } from './keys';

export function validateProjectName(name: string): string | null {
	if (!name) return 'Enter a name.';
	if (name.length > 100) return 'Use at most 100 characters.';
	return null;
}

export async function listOrganizationsForUser(db: Db, userId: string) {
	return db
		.select({ id: organizations.id, name: organizations.name, role: memberships.role })
		.from(memberships)
		.innerJoin(organizations, eq(memberships.organizationId, organizations.id))
		.where(eq(memberships.userId, userId))
		.orderBy(asc(organizations.name));
}

export async function listProjectsForUser(db: Db, userId: string) {
	return db
		.select({
			id: projects.id,
			name: projects.name,
			organizationId: projects.organizationId,
			organizationName: organizations.name
		})
		.from(projects)
		.innerJoin(organizations, eq(projects.organizationId, organizations.id))
		.innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
		.where(eq(memberships.userId, userId))
		.orderBy(asc(organizations.name), asc(projects.name));
}

/** The project with the user's role in its organization, or null when the user is not a member. */
export async function getProjectForUser(db: Db, userId: string, projectId: string) {
	const [row] = await db
		.select({ project: projects, role: memberships.role })
		.from(projects)
		.innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
		.where(and(eq(projects.id, projectId), eq(memberships.userId, userId)));
	return row ?? null;
}

export async function getMembership(db: Db, userId: string, organizationId: string) {
	const [row] = await db
		.select()
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
	return row ?? null;
}

export async function createProject(db: Db, organizationId: string, name: string) {
	const [project] = await db
		.insert(projects)
		.values({ organizationId, name, publicKey: generatePublicKey() })
		.returning();
	if (!project) throw new Error('failed to create project');
	return project;
}

export async function renameProject(db: Db, projectId: string, name: string) {
	await db.update(projects).set({ name }).where(eq(projects.id, projectId));
}

/** Replaces the public key. The ingest service rejects the old key once it refreshes its key cache. */
export async function rotatePublicKey(db: Db, projectId: string): Promise<string> {
	const publicKey = generatePublicKey();
	await db.update(projects).set({ publicKey }).where(eq(projects.id, projectId));
	return publicKey;
}

export async function deleteProject(db: Db, projectId: string) {
	await db.delete(projects).where(eq(projects.id, projectId));
}
