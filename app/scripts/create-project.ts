// Creates an organization and a project and prints the project's public key.
// Usage: bun run create-project --org "Acme" --name "Website"
// The dashboard does the same at /projects; this is for scripted setups.
import { parseArgs } from 'node:util';
import { organizations, projects } from '../src/lib/server/db/schema';
import { generatePublicKey } from '../src/lib/server/keys';
import { db } from './config';

const { values } = parseArgs({
	options: { org: { type: 'string' }, name: { type: 'string' } }
});
if (!values.org || !values.name) {
	console.error('Usage: bun run create-project --org <organization> --name <project>');
	process.exit(1);
}

const database = db();
const [organization] = await database
	.insert(organizations)
	.values({ name: values.org })
	.returning();
if (!organization) throw new Error('failed to create organization');
const [project] = await database
	.insert(projects)
	.values({ organizationId: organization.id, name: values.name, publicKey: generatePublicKey() })
	.returning();
if (!project) throw new Error('failed to create project');

console.log(`Project ${project.name} (${project.id})`);
console.log(`Public key: ${project.publicKey}`);
