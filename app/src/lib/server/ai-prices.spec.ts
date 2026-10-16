import { describe, expect, it } from 'vitest';
import { normalizeModel } from '../ai-prices';
import { deleteModelPrice, modelPrices, parsePriceForm, setModelPrice } from './ai-prices';
import { organizations } from './db/schema';
import { createProject } from './projects';
import { createTestDb } from './test-db';

async function setup() {
	const db = await createTestDb();
	const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
	const project = await createProject(db, org.id, 'Website');
	const other = await createProject(db, org.id, 'App');
	return { db, project, other };
}

function form(values: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe('model prices', () => {
	it('puts a project’s own prices over the built-in ones', async () => {
		const { db, project, other } = await setup();
		await setModelPrice(db, project.id, { model: 'gpt-4o', input: 1, output: 2 });
		await setModelPrice(db, project.id, { model: 'my-model', input: 3, output: 4, cacheRead: 0.3 });
		await setModelPrice(db, project.id, { model: 'my-model', input: 5, output: 6 });

		const prices = await modelPrices(db, project.id);
		expect(prices.find((p) => p.model === 'gpt-4o')).toMatchObject({ input: 1, custom: true });
		expect(prices.find((p) => p.model === 'my-model')).toEqual({
			model: 'my-model',
			input: 5,
			output: 6,
			cacheRead: undefined,
			cacheWrite: undefined,
			custom: true
		});
		expect(prices.find((p) => p.model === 'gpt-4o-mini')).toMatchObject({ custom: false });
		expect((await modelPrices(db, other.id)).find((p) => p.model === 'gpt-4o')).toMatchObject({
			input: 2.5,
			custom: false
		});

		await deleteModelPrice(db, project.id, 'gpt-4o');
		await deleteModelPrice(db, project.id, 'my-model');
		const reverted = await modelPrices(db, project.id);
		expect(reverted.find((p) => p.model === 'gpt-4o')).toMatchObject({ input: 2.5, custom: false });
		expect(reverted.some((p) => p.model === 'my-model')).toBe(false);
	});

	it('reads prices from a form', () => {
		expect(
			parsePriceForm(form({ model: ' OpenAI/GPT-4o ', input: '2.5', output: '10', cacheRead: '' }))
		).toEqual({
			model: 'gpt-4o',
			input: 2.5,
			output: 10,
			cacheRead: undefined,
			cacheWrite: undefined
		});
		expect(
			parsePriceForm(form({ model: 'x', input: '0', output: '0', cacheWrite: '1.25' }))
		).toMatchObject({
			cacheWrite: 1.25
		});
		expect(parsePriceForm(form({ model: '', input: '1', output: '1' }))).toMatch(/model name/);
		expect(parsePriceForm(form({ model: 'a b', input: '1', output: '1' }))).toMatch(/model name/);
		expect(parsePriceForm(form({ model: 'x', input: '-1', output: '1' }))).toMatch(/USD/);
		expect(parsePriceForm(form({ model: 'x', input: '1' }))).toMatch(/USD/);
		expect(parsePriceForm(form({ model: 'x', input: '1', output: 'abc' }))).toMatch(/USD/);
	});

	it('normalizes model names like ingest does', () => {
		expect(normalizeModel(' Anthropic/Claude-Sonnet-4-5 ')).toBe('claude-sonnet-4-5');
		expect(normalizeModel('gpt-4o')).toBe('gpt-4o');
	});
});
