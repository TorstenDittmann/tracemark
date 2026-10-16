import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organizations } = await parent();
	const [first] = organizations;
	if (organizations.length === 1 && first) redirect(303, `/organizations/${first.id}`);
	return {};
};
