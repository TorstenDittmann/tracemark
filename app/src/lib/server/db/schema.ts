import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

export type Organization = typeof organizations.$inferSelect;
export type Project = typeof projects.$inferSelect;
