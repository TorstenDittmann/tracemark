import { afterEach, describe, expect, it, vi } from 'vitest';
import { make, mockFetch, sentEvents } from './helpers';

const autocaptured = (f: ReturnType<typeof mockFetch>) =>
	sentEvents(f)
		.filter((e) => e.event === '$autocapture')
		.map((e) => e.properties ?? {});

function html(markup: string) {
	document.body.innerHTML = markup;
}

function click(selector: string) {
	document.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('click and form autocapture', () => {
	it('captures clicks on buttons and links with a description of the element', async () => {
		html(`<nav id="top"><div class="menu main extra">
			<button class="btn primary" data-plan="pro" data-tm-capture="x"><span>  Sign
				up </span></button>
			<a href="/pricing?ref=nav">Pricing</a>
		</div></nav>`);
		const f = mockFetch();
		const c = make({ autocaptureClicks: true });
		click('button span');
		click('a');
		await c.flush();
		const [button, link] = autocaptured(f);
		expect(button).toMatchObject({
			$event_type: 'click',
			$el_tag: 'button',
			$el_text: 'Sign up',
			$el_selector: 'nav#top > div.menu.main > button.btn.primary',
			'$el_attr__data-plan': 'pro',
			$pathname: '/'
		});
		expect(button).not.toHaveProperty('$el_attr__data-tm-capture');
		expect(link).toMatchObject({ $el_tag: 'a', $el_text: 'Pricing', $el_href: '/pricing?ref=nav' });
	});

	it('captures role=button, submit inputs and marked elements, but not plain elements', async () => {
		html(`<div role="button">Menu</div>
			<input type="submit" value="secret value" aria-label="Send">
			<input type="button" value="typed">
			<li data-tm-capture>Card</li>
			<p>Just text</p>`);
		const f = mockFetch();
		const c = make({ autocaptureClicks: true });
		for (const s of ['[role=button]', 'input[type=submit]', 'input[type=button]', 'li', 'p'])
			click(s);
		await c.flush();
		const events = autocaptured(f);
		expect(events.map((e) => [e.$el_tag, e.$el_text])).toEqual([
			['div', 'Menu'],
			['input', 'Send'],
			['input', undefined],
			['li', 'Card']
		]);
		expect(JSON.stringify(events)).not.toContain('secret value');
		expect(JSON.stringify(events)).not.toContain('typed');
	});

	it('skips data-tm-no-capture, password fields and card numbers', async () => {
		html(`<section data-tm-no-capture><button>Hidden</button></section>
			<div data-tm-capture><input type="password" id="pw"></div>
			<button id="card">4242 4242 4242 4242</button>`);
		const f = mockFetch();
		const c = make({ autocaptureClicks: true });
		click('section button');
		click('#pw');
		click('#card');
		await c.flush();
		const events = autocaptured(f);
		expect(events).toHaveLength(1);
		expect(events[0]?.$el_selector).toBe('button#card');
		expect(events[0]).not.toHaveProperty('$el_text');
	});

	it('captures form submits with the submit button text, never field values', async () => {
		html(
			'<form id="signup"><input name="email" value="ada@example.com"><button>Create account</button></form>'
		);
		const f = mockFetch();
		const c = make({ autocaptureForms: true });
		const form = document.querySelector('form') as HTMLFormElement;
		form.dispatchEvent(
			new SubmitEvent('submit', { bubbles: true, submitter: form.querySelector('button') })
		);
		await c.flush();
		const events = autocaptured(f);
		expect(events).toEqual([
			expect.objectContaining({
				$event_type: 'submit',
				$el_tag: 'form',
				$el_selector: 'form#signup',
				$el_text: 'Create account'
			})
		]);
		expect(JSON.stringify(events)).not.toContain('ada@example.com');
	});

	it('is off by default and stops on destroy', async () => {
		html('<button>Go</button>');
		const f = mockFetch();
		const c = make();
		click('button');
		const d = make({ autocaptureClicks: true });
		d.destroy();
		click('button');
		await c.flush();
		expect(autocaptured(f)).toEqual([]);
	});
});

describe('click positions and heatmaps', () => {
	const sent = (f: ReturnType<typeof mockFetch>, event: string) =>
		sentEvents(f)
			.filter((e) => e.event === event)
			.map((e) => e.properties ?? {});

	/** A page 1000 px wide and 4000 px tall. */
	function layout() {
		const root = document.documentElement;
		Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 1000 });
		Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 4000 });
	}

	function clickAt(selector: string, x: number, y: number, detail = 1) {
		const e = new MouseEvent('click', { bubbles: true, detail, clientX: x, clientY: y });
		Object.defineProperty(e, 'pageX', { value: x });
		Object.defineProperty(e, 'pageY', { value: y });
		document.querySelector(selector)?.dispatchEvent(e);
	}

	afterEach(() => {
		const root = document.documentElement as unknown as Record<string, unknown>;
		delete root.scrollWidth;
		delete root.scrollHeight;
		vi.useRealTimers();
	});

	it('adds where an autocaptured click landed, as fractions of the document', async () => {
		html('<button>Go</button>');
		layout();
		const f = mockFetch();
		const c = make({ autocaptureClicks: true });
		clickAt('button', 333, 1234);
		clickAt('button', 0, 0, 0);
		await c.flush();
		const [mouse, keyboard] = autocaptured(f);
		expect(mouse).toMatchObject({ $click_x: 0.333, $click_y: 0.3085, $document_height: 4000 });
		expect(mouse?.$viewport_width).toBeTypeOf('number');
		expect(keyboard).not.toHaveProperty('$click_x');
	});

	it('sends other clicks as lightweight $heatmap_click events with heatmaps', async () => {
		html(`<main class="hero"><p id="tagline">Hello <b>there</b></p><button>Go</button>
			<div data-tm-no-capture><span>Private</span></div><input type="password"></main>`);
		layout();
		const f = mockFetch();
		const c = make({ autocaptureClicks: true, heatmaps: true });
		clickAt('b', 500, 2000);
		clickAt('button', 10, 10);
		clickAt('span', 10, 10);
		clickAt('input', 10, 10);
		await c.flush();
		const heat = sent(f, '$heatmap_click');
		expect(heat).toEqual([
			{
				$click_x: 0.5,
				$click_y: 0.5,
				$document_height: 4000,
				$el_selector: 'p#tagline > b',
				$pathname: '/',
				$host: expect.any(String),
				$viewport_width: expect.any(Number),
				$viewport_height: expect.any(Number),
				$lib: 'tracemark-browser',
				$lib_version: expect.any(String)
			}
		]);
		expect(autocaptured(f)).toHaveLength(1);
	});

	it('records every click as a heatmap click without click autocapture, throttled', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		html('<button class="cta">Go</button><p>Text</p>');
		layout();
		const f = mockFetch();
		const c = make({ heatmaps: true });
		clickAt('button', 1, 1);
		clickAt('p', 1, 1);
		vi.advanceTimersByTime(150);
		clickAt('p', 1, 1);
		for (let i = 0; i < 150; i++) {
			vi.advanceTimersByTime(150);
			clickAt('p', 1, 1);
		}
		await c.flush();
		const heat = sent(f, '$heatmap_click');
		expect(heat[0]?.$el_selector).toBe('button.cta');
		expect(heat[1]?.$el_selector).toBe('p');
		expect(heat).toHaveLength(100);
		expect(autocaptured(f)).toEqual([]);
	});

	it('sends nothing from the dashboard heatmap frame', async () => {
		html('<button>Go</button>');
		layout();
		window.name = 'tracemark-heatmap';
		try {
			const f = mockFetch();
			const c = make({ autocaptureClicks: true, heatmaps: true });
			clickAt('button', 1, 1);
			c.capture('custom');
			await c.flush();
			expect(sentEvents(f)).toEqual([]);
		} finally {
			window.name = '';
		}
	});
});
