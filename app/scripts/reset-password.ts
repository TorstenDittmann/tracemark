// Sets a new password for a user and signs them out everywhere.
// Usage: bun run reset-password --email ada@example.com   (prompts for the password)
import { parseArgs } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { normalizeEmail } from '../src/lib/server/accounts';
import { createAuth, MIN_PASSWORD_LENGTH } from '../src/lib/server/auth/index';
import { accounts, users } from '../src/lib/server/db/schema';
import { db } from './config';

const { values } = parseArgs({ options: { email: { type: 'string' } } });
if (!values.email) {
	console.error('Usage: bun run reset-password --email <email>');
	process.exit(1);
}

const email = normalizeEmail(values.email);
const database = db();
const [user] = await database.select().from(users).where(eq(users.email, email));
if (!user) {
	console.error(`No user with email ${email}`);
	process.exit(1);
}

const password = prompt('New password:') ?? '';
if (password.length < MIN_PASSWORD_LENGTH || password.length > 256) {
	console.error(`Use between ${MIN_PASSWORD_LENGTH} and 256 characters.`);
	process.exit(1);
}

const context = await createAuth(database, {
	baseURL: process.env.PUBLIC_URL,
	secret: process.env.AUTH_SECRET
}).$context;
const updated = await database
	.update(accounts)
	.set({ password: await context.password.hash(password) })
	.where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
	.returning({ id: accounts.id });
if (updated.length === 0) {
	console.error(`${email} has no password sign-in.`);
	process.exit(1);
}
await context.internalAdapter.deleteUserSessions(user.id);
console.log(`Password updated for ${email}; existing sessions were signed out.`);
