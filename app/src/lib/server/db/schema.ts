import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

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
	/** Server-only key for flag definitions, source map uploads and the query API; never sent to browsers. */
	secretKey: text('secret_key').unique(),
	/** Days of events to keep; null keeps everything. */
	retentionDays: integer('retention_days'),
	createdAt: createdAt()
});

/** A named trends, funnel or retention query. `query` is the JSON the editors put in the URL. */
export const insights = sqliteTable(
	'insights',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: text('kind', { enum: ['trends', 'funnel', 'retention'] }).notNull(),
		query: text('query').notNull(),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('insights_project_id_idx').on(table.projectId)]
);

export const dashboards = sqliteTable(
	'dashboards',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdAt: createdAt()
	},
	(table) => [index('dashboards_project_id_idx').on(table.projectId)]
);

/** Insights on a dashboard, in `position` order. */
export const dashboardInsights = sqliteTable(
	'dashboard_insights',
	{
		dashboardId: text('dashboard_id')
			.notNull()
			.references(() => dashboards.id, { onDelete: 'cascade' }),
		insightId: text('insight_id')
			.notNull()
			.references(() => insights.id, { onDelete: 'cascade' }),
		position: integer('position').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.dashboardId, table.insightId] }),
		index('dashboard_insights_insight_id_idx').on(table.insightId)
	]
);

/**
 * Random salts for cookieless visitor hashes, one per UTC day. Old days are deleted so a
 * hash can not be recomputed from an IP address and user agent later.
 */
export const dailySalts = sqliteTable('daily_salts', {
	day: text('day').primaryKey(),
	salt: text('salt').notNull()
});

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type Dashboard = typeof dashboards.$inferSelect;

export const cohorts = sqliteTable(
	'cohorts',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: text('kind', { enum: ['static', 'properties'] }).notNull(),
		/** Person property filters (JSON) for a `properties` cohort; static members live in ClickHouse. */
		filters: text('filters').notNull().default('[]'),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('cohorts_project_id_idx').on(table.projectId)]
);

export type Cohort = typeof cohorts.$inferSelect;

/**
 * A feature flag. `definition` is the JSON of everything a `FlagDefinition` holds besides its
 * key and active state: group type, conditions, variants and payloads.
 */
export const featureFlags = sqliteTable(
	'feature_flags',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		description: text('description').notNull().default(''),
		active: integer('active', { mode: 'boolean' }).notNull().default(false),
		definition: text('definition').notNull(),
		/** Bumped on every change; matches the latest `flag_versions` row. */
		version: integer('version').notNull().default(1),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [uniqueIndex('feature_flags_project_key_idx').on(table.projectId, table.key)]
);

/** Every saved state of a flag, for its history. */
export const flagVersions = sqliteTable(
	'flag_versions',
	{
		id: id(),
		flagId: text('flag_id')
			.notNull()
			.references(() => featureFlags.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		description: text('description').notNull(),
		active: integer('active', { mode: 'boolean' }).notNull(),
		definition: text('definition').notNull(),
		changedBy: text('changed_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('flag_versions_flag_version_idx').on(table.flagId, table.version)]
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type FlagVersion = typeof flagVersions.$inferSelect;

/** An experiment comparing the variants of a multivariate flag on a set of metrics. */
export const experiments = sqliteTable(
	'experiments',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		flagId: text('flag_id')
			.notNull()
			.references(() => featureFlags.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		status: text('status', { enum: ['draft', 'running', 'complete'] })
			.notNull()
			.default('draft'),
		/** `ExperimentMetric[]` as JSON. */
		metrics: text('metrics').notNull().default('[]'),
		startedAt: timestamp('started_at'),
		endedAt: timestamp('ended_at'),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('experiments_project_id_idx').on(table.projectId),
		index('experiments_flag_id_idx').on(table.flagId)
	]
);

export type Experiment = typeof experiments.$inferSelect;

/**
 * Triage state of an error issue. Issues themselves are `$exception` events grouped by
 * fingerprint in ClickHouse; a row exists here once someone resolved or ignored one.
 */
export const errorIssues = sqliteTable(
	'error_issues',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		status: text('status', { enum: ['open', 'resolved', 'ignored'] })
			.notNull()
			.default('open'),
		statusChangedAt: timestamp('status_changed_at')
			.notNull()
			.default(sql`(unixepoch('subsec') * 1000)`),
		statusChangedBy: text('status_changed_by').references(() => users.id, {
			onDelete: 'set null'
		})
	},
	(table) => [
		uniqueIndex('error_issues_project_fingerprint_idx').on(table.projectId, table.fingerprint)
	]
);

export type ErrorIssue = typeof errorIssues.$inferSelect;

/**
 * Source maps uploaded with `tracemark sourcemaps upload`. The map itself is a gzipped file under
 * SOURCEMAPS_DIR; `name` is the minified file's URL with `~` for any origin, e.g.
 * `~/assets/index-B3xk9aZ1.js`.
 */
export const sourcemaps = sqliteTable(
	'sourcemaps',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		/** Empty when uploaded without a release; such maps match events of any release. */
		release: text('release').notNull().default(''),
		name: text('name').notNull(),
		/** Uncompressed bytes. */
		size: integer('size').notNull(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('sourcemaps_project_release_name_idx').on(
			table.projectId,
			table.release,
			table.name
		)
	]
);

export type Sourcemap = typeof sourcemaps.$inferSelect;

/**
 * A project's own token prices, in USD per million tokens. They override the built-in list in
 * `$lib/ai-prices.ts` for the same model; ingest uses them to compute `$ai_cost_usd`.
 */
export const aiModelPrices = sqliteTable(
	'ai_model_prices',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		/** Matches models with this name or starting with it, such as `gpt-4o` for `gpt-4o-2024-08-06`. */
		model: text('model').notNull(),
		input: real('input').notNull(),
		output: real('output').notNull(),
		/** Cached input tokens read; the input price when unset. */
		cacheRead: real('cache_read'),
		/** Input tokens written to the cache; the input price when unset. */
		cacheWrite: real('cache_write'),
		updatedAt: timestamp('updated_at').notNull().default(sql`(unixepoch('subsec') * 1000)`)
	},
	(table) => [uniqueIndex('ai_model_prices_project_model_idx').on(table.projectId, table.model)]
);

export type AiModelPrice = typeof aiModelPrices.$inferSelect;
