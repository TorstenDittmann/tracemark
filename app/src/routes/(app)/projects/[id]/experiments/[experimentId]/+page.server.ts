import { error, fail, type RequestEvent, redirect } from '@sveltejs/kit';
import {
	type ExperimentMetric,
	experimentsHref,
	MAX_NAME,
	metricLabel,
	parseMetrics,
	storedMetrics
} from '#lib/experiments.js';
import { MAX_DESCRIPTION } from '#lib/flags.js';
import { eventNames, experimentCounts } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import {
	deleteExperiment,
	getExperiment,
	launchExperiment,
	stopExperiment,
	updateExperiment
} from '#lib/server/experiments.js';
import { flagDefinition, getFlag, updateFlag } from '#lib/server/flags.js';
import { getProjectForUser } from '#lib/server/projects.js';
import { conversionResults, countResults, type VariantSummary } from '#lib/stats.js';
import type { Actions, PageServerLoad } from './$types';

interface MetricResults {
	metric: ExperimentMetric;
	label: string;
	variants: VariantSummary[];
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { project } = await parent();
	const db = getDb();
	const experiment = await getExperiment(db, project.id, params.experimentId);
	if (!experiment) error(404, 'Experiment not found');
	const flag = await getFlag(db, project.id, experiment.flagId);
	const definition = flag && flagDefinition(flag);
	const variants = definition?.variants.map((variant) => variant.key) ?? [];
	const metrics = storedMetrics(experiment.metrics);

	let results: {
		exposures: { variant: string; people: number }[];
		metrics: MetricResults[];
	} | null = null;
	let resultsFailed = false;
	if (experiment.startedAt && variants.length) {
		try {
			const counts = await experimentCounts(project.id, {
				flag: flag?.key ?? '',
				variants,
				metrics,
				from: experiment.startedAt,
				to: experiment.endedAt ?? new Date()
			});
			results = {
				exposures: counts.map(({ variant, people }) => ({ variant, people })),
				metrics: metrics.map((metric, i) => {
					const data = counts.map((c) => ({
						key: c.variant,
						people: c.people,
						value: c.values[i] ?? 0
					}));
					return {
						metric,
						label: metricLabel(metric),
						variants: metric.kind === 'conversion' ? conversionResults(data) : countResults(data)
					};
				})
			};
		} catch (err) {
			console.error('experiment results unavailable:', err);
			resultsFailed = true;
		}
	}

	const events = await eventNames(project.id).then(
		(names) => names.map((name) => name.event),
		(err) => {
			console.error('event suggestions unavailable:', err);
			return [] as string[];
		}
	);

	return {
		experiment: {
			id: experiment.id,
			name: experiment.name,
			description: experiment.description,
			status: experiment.status,
			metrics,
			startedAt: experiment.startedAt,
			endedAt: experiment.endedAt
		},
		flag: flag && {
			id: flag.id,
			key: flag.key,
			active: flag.active,
			variants: definition?.variants ?? []
		},
		results,
		resultsFailed,
		events
	};
};

/** Actions don't run layout loads, so each one checks access itself. */
async function access(event: RequestEvent<{ id: string; experimentId: string }>) {
	const { locals, params } = event;
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	const experiment = await getExperiment(getDb(), row.project.id, params.experimentId);
	if (!experiment) error(404, 'Experiment not found');
	return { project: row.project, experiment, userId: locals.user.id };
}

export const actions: Actions = {
	save: async (event) => {
		const { experiment } = await access(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!name || name.length > MAX_NAME) {
			return fail(400, {
				action: 'save',
				message: 'Give the experiment a name under 200 characters.'
			});
		}
		if (description.length > MAX_DESCRIPTION) {
			return fail(400, { action: 'save', message: 'Keep the description under 500 characters.' });
		}
		let metrics: ExperimentMetric[];
		try {
			metrics = parseMetrics(JSON.parse(String(form.get('metrics') ?? '')));
		} catch (err) {
			return fail(400, {
				action: 'save',
				message: err instanceof Error ? err.message : 'The metrics are not valid.'
			});
		}
		await updateExperiment(getDb(), experiment, { name, description, metrics });
		return { action: 'save', ok: true, message: 'Saved.' };
	},

	launch: async (event) => {
		const { project, experiment, userId } = await access(event);
		if (!storedMetrics(experiment.metrics).length) {
			return fail(400, { action: 'launch', message: 'Add a metric before launching.' });
		}
		const flag = await getFlag(getDb(), project.id, experiment.flagId);
		const definition = flag && flagDefinition(flag);
		if (!flag || !definition || definition.variants.length < 2) {
			return fail(400, {
				action: 'launch',
				message: 'The flag needs at least two variants before the experiment can launch.'
			});
		}
		if (!(await launchExperiment(getDb(), experiment))) {
			return fail(409, { action: 'launch', message: 'This experiment has already launched.' });
		}
		// Launching serves the variants: the flag turns on if it was off.
		if (!definition.active) {
			await updateFlag(getDb(), flag, {
				flag: { ...definition, active: true },
				description: flag.description,
				userId
			});
		}
		return { action: 'launch', ok: true, message: 'Launched.' };
	},

	stop: async (event) => {
		const { experiment } = await access(event);
		if (!(await stopExperiment(getDb(), experiment))) {
			return fail(409, { action: 'stop', message: 'This experiment is not running.' });
		}
		return { action: 'stop', ok: true, message: 'Stopped. Results are final from now.' };
	},

	delete: async (event) => {
		const { project, experiment } = await access(event);
		await deleteExperiment(getDb(), project.id, experiment.id);
		redirect(303, experimentsHref(project.id));
	}
};
