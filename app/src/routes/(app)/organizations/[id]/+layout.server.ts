import { error, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getOrganizationForUser } from '#lib/server/members.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(303, '/login');
	const row = await getOrganizationForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Organization not found');
	return {
		organization: { id: row.organization.id, name: row.organization.name },
		role: row.role
	};
};
