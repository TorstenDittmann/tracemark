import Activity from '@lucide/svelte/icons/activity';
import Bug from '@lucide/svelte/icons/bug';
import Building2 from '@lucide/svelte/icons/building-2';
import ChartSpline from '@lucide/svelte/icons/chart-spline';
import FlaskConical from '@lucide/svelte/icons/flask-conical';
import Globe from '@lucide/svelte/icons/globe';
import House from '@lucide/svelte/icons/house';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Settings from '@lucide/svelte/icons/settings';
import Sparkles from '@lucide/svelte/icons/sparkles';
import ToggleRight from '@lucide/svelte/icons/toggle-right';
import Users from '@lucide/svelte/icons/users';
import type { Component } from 'svelte';

export interface NavItem {
	/** Path below `/projects/[id]`, empty for the overview. */
	path: string;
	label: string;
	description: string;
	icon: Component;
	/** Other path prefixes that count as this section, such as cohorts under People. */
	also?: string[];
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

export const PROJECT_NAV: NavGroup[] = [
	{
		label: 'Product analytics',
		items: [
			{
				path: '',
				label: 'Home',
				description: 'How this project is doing at a glance.',
				icon: House
			},
			{
				path: '/web',
				label: 'Web analytics',
				description: 'Visitors, pages, sources and devices.',
				icon: Globe
			},
			{
				path: '/insights',
				label: 'Insights',
				description: 'Trends, funnels and retention over your events.',
				icon: ChartSpline
			},
			{
				path: '/dashboards',
				label: 'Dashboards',
				description: 'Saved insights, grouped for your team.',
				icon: LayoutGrid
			},
			{
				path: '/events',
				label: 'Events',
				description: 'Every event as it arrives, and what they carry.',
				icon: Activity
			}
		]
	},
	{
		label: 'Audience',
		items: [
			{
				path: '/persons',
				label: 'People',
				description: 'Who uses your product, and the cohorts they form.',
				icon: Users,
				also: ['/cohorts']
			},
			{
				path: '/groups',
				label: 'Groups',
				description: 'Companies, teams and other accounts.',
				icon: Building2
			}
		]
	},
	{
		label: 'Release',
		items: [
			{
				path: '/flags',
				label: 'Feature flags',
				description: 'Roll out safely, to the right people.',
				icon: ToggleRight
			},
			{
				path: '/experiments',
				label: 'Experiments',
				description: 'Test variants and measure what wins.',
				icon: FlaskConical
			}
		]
	},
	{
		label: 'Monitor',
		items: [
			{
				path: '/issues',
				label: 'Issues',
				description: 'Errors grouped into issues, with stack traces.',
				icon: Bug
			},
			{
				path: '/ai',
				label: 'AI',
				description: 'LLM calls, costs, latency and traces.',
				icon: Sparkles
			}
		]
	}
];

export const SETTINGS_NAV: NavItem = {
	path: '/settings',
	label: 'Settings',
	description: 'Keys, data retention and privacy for this project.',
	icon: Settings
};

const ALL = [...PROJECT_NAV.flatMap((group) => group.items), SETTINGS_NAV];

/** The section a pathname belongs to, inside the given project. */
export function activeNavItem(projectId: string, pathname: string): NavItem | undefined {
	const base = `/projects/${projectId}`;
	if (pathname === base || pathname === `${base}/`) return ALL[0];
	const rest = pathname.slice(base.length);
	return ALL.find(
		(item) =>
			item.path &&
			[item.path, ...(item.also ?? [])].some(
				(prefix) => rest === prefix || rest.startsWith(`${prefix}/`)
			)
	);
}
