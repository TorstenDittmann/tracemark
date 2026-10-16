import { createClient, type FootprintClient, type WireEvent } from '@footprint/browser';
import { createErrors } from '@footprint/browser/errors';
import { createFlags } from '@footprint/browser/flags';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createSSRApp, defineComponent, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
	createFootprint,
	useFeatureFlag,
	useFeatureFlagEnabled,
	useFeatureFlagPayload,
	useFootprint
} from '../src/index';

const HOST = 'https://ingest.example.com';
const options = { apiKey: 'fp_pub_test', host: HOST, autocapturePageviews: false };

let answer: unknown;
let events: WireEvent[];
const clients: FootprintClient[] = [];
const unmounts: (() => void)[] = [];

beforeEach(() => {
	answer = { flags: { pricing: 'cheaper', beta: true }, payloads: { pricing: { price: 9 } } };
	events = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			if (url === `${HOST}/flags`) return { ok: true, status: 200, json: async () => answer };
			events.push(...body.batch);
			return { ok: true, status: 202, json: async () => ({}) };
		})
	);
});

afterEach(() => {
	for (const unmount of unmounts.splice(0)) unmount();
	for (const client of clients.splice(0)) client.destroy();
	localStorage.clear();
});

function mount(
	component: ReturnType<typeof defineComponent>,
	plugin: ReturnType<typeof createFootprint>
) {
	const app = createApp(component);
	app.use(plugin);
	const el = document.createElement('div');
	app.mount(el);
	unmounts.push(() => app.unmount());
	return { app, el };
}

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	await nextTick();
};

describe('vue plugin', () => {
	it('sets up the client and renders flags as they load and change', async () => {
		const client = createClient();
		clients.push(client);
		const flags = createFlags({ bootstrap: { flags: { pricing: 'control' } } });
		const Pricing = defineComponent(() => {
			const pricing = useFeatureFlag('pricing');
			const beta = useFeatureFlagEnabled('beta');
			const payload = useFeatureFlagPayload<{ price: number }>('pricing');
			const fp = useFootprint();
			return () =>
				h('p', `${pricing.value} ${beta.value} ${payload.value?.price ?? '-'} ${fp === client}`);
		});
		const { el } = mount(Pricing, createFootprint({ client, options, flags }));
		expect(client.config?.apiKey).toBe('fp_pub_test');
		expect(el.textContent).toBe('control false - true');
		await flags.ready();
		await settle();
		expect(el.textContent).toBe('cheaper true 9 true');
		answer = { flags: { pricing: 'other' }, payloads: {} };
		await flags.reload();
		await settle();
		expect(el.textContent).toBe('other false - true');
		await client.flush();
		const exposures = events
			.filter((e) => e.event === '$feature_flag_called')
			.map((e) => [e.properties?.$feature_flag, e.properties?.$feature_flag_response]);
		// The bootstrap was evaluated for this visitor, so what it showed first counts too.
		expect(exposures).toEqual([
			['pricing', 'control'],
			['beta', false],
			['pricing', 'cheaper'],
			['beta', true],
			['pricing', 'other'],
			['beta', false]
		]);
	});

	it('captures component errors and keeps an existing handler', async () => {
		const client = createClient();
		clients.push(client);
		const errors = createErrors();
		const seen: unknown[] = [];
		const Broken = defineComponent({
			name: 'BrokenWidget',
			setup() {
				return () => {
					throw new Error('kaput');
				};
			}
		});
		const app = createApp(Broken);
		app.config.errorHandler = (error) => {
			seen.push(error);
		};
		app.use(createFootprint({ client, options, errors }));
		app.mount(document.createElement('div'));
		unmounts.push(() => app.unmount());
		await client.flush();
		const [error] = events.filter((e) => e.event === '$exception');
		expect(seen).toHaveLength(1);
		expect(error?.properties).toMatchObject({
			$vue_info: 'render function',
			$vue_component: 'BrokenWidget'
		});
		const list = error?.properties?.$exception_list as { mechanism: unknown }[] | undefined;
		expect(list?.[0]?.mechanism).toEqual({ type: 'vue', handled: false });
	});

	it('renders the bootstrapped value on the server without recording', async () => {
		const flags = createFlags({ bootstrap: { flags: { pricing: 'control' } } });
		const Pricing = defineComponent(() => {
			const pricing = useFeatureFlag('pricing');
			return () => h('p', String(pricing.value));
		});
		const app = createSSRApp(Pricing);
		app.use(createFootprint({ flags }));
		expect(await renderToString(app)).toBe('<p>control</p>');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('asks for flags when they were not passed', () => {
		const Pricing = defineComponent(() => {
			useFeatureFlag('pricing');
			return () => null;
		});
		const app = createApp(Pricing);
		app.config.warnHandler = () => {};
		app.use(createFootprint({}));
		expect(() => app.mount(document.createElement('div'))).toThrow(/pass `flags`/);
	});
});
