import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { projects } = await parent();
	const [first] = projects;
	redirect(303, first ? `/projects/${first.id}` : '/projects');
};
