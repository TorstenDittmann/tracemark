import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Tables named after better-auth models (users, sessions, accounts, verifications, and the
// organization plugin's organizations, members, invitations) are managed through better-auth;
// keep their columns in sync with its schema when upgrading it.

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

const createdAt = () =>
	timestamp('created_at').notNull().default(sql`(unixepoch('subsec') * 1000)`);

const updatedAt = () =>
	timestamp('updated_at')
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`)
		.$onUpdate(() => new Date());

export const users = sqliteTable('users', {
	id: id(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const sessions = sqliteTable(
	'sessions',
	{
		id: id(),
		token: text('token').notNull().unique(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		activeOrganizationId: text('active_organization_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
);

export const accounts = sqliteTable(
	'accounts',
	{
		id: id(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
		scope: text('scope'),
		/** Password hash for the `credential` provider. */
		password: text('password'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('accounts_user_id_idx').on(table.userId)]
);

export const verifications = sqliteTable(
	'verifications',
	{
		id: id(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('verifications_identifier_idx').on(table.identifier)]
);

export const organizations = sqliteTable('organizations', {
	id: id(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	logo: text('logo'),
	metadata: text('metadata'),
	createdAt: createdAt()
});

export const members = sqliteTable(
	'members',
	{
		id: id(),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** `owner`, `admin` or `member` (better-auth organization roles). */
		role: text('role').notNull().default('member'),
		createdAt: createdAt()
	},
	(table) => [
		index('members_organization_id_idx').on(table.organizationId),
		index('members_user_id_idx').on(table.userId)
	]
);

export const invitations = sqliteTable(
	'invitations',
	{
		id: id(),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		role: text('role'),
		status: text('status').notNull().default('pending'),
		expiresAt: timestamp('expires_at').notNull(),
		inviterId: text('inviter_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(table) => [
		index('invitations_organization_id_idx').on(table.organizationId),
		index('invitations_email_idx').on(table.email)
	]
);

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

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Project = typeof projects.$inferSelect;
