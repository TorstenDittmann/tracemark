import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

export const organizations = sqliteTable('organizations', {
	id: id(),
	name: text('name').notNull(),
	createdAt: createdAt()
});

export const projects = sqliteTable('projects', {
	id: id(),
	organizationId: text('organization_id')
		.notNull()
		.references(() => organizations.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	/** Write-only key embedded in SDKs; safe to expose in browsers. */
	publicKey: text('public_key').notNull().unique(),
	/** Days of events to keep; null keeps everything. */
	retentionDays: integer('retention_days'),
	createdAt: createdAt()
});

export const users = sqliteTable('users', {
	id: id(),
	/** Stored lowercased. */
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	passwordHash: text('password_hash').notNull(),
	createdAt: createdAt()
});

export const sessions = sqliteTable(
	'sessions',
	{
		/** SHA-256 of the session token; the token itself only lives in the cookie. */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
);

export const memberships = sqliteTable(
	'memberships',
	{
		organizationId: text('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'member'] }).notNull(),
		createdAt: createdAt()
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.userId] }),
		index('memberships_user_id_idx').on(table.userId)
	]
);

export type Organization = typeof organizations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
