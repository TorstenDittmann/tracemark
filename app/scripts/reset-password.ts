// Sets a new password for a user and signs them out everywhere.
// Usage: bun run reset-password --email ada@example.com   (prompts for the password)
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { normalizeEmail, setPassword, validateCredentials } from '../src/lib/server/accounts';
import { invalidateUserSessions } from '../src/lib/server/auth/session';
import { users } from '../src/lib/server/db/schema';
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
const errors = validateCredentials({ email, password });
if (errors?.password) {
	console.error(errors.password);
	process.exit(1);
}

await setPassword(database, user.id, password);
await invalidateUserSessions(database, user.id);
console.log(`Password updated for ${email}; existing sessions were signed out.`);
