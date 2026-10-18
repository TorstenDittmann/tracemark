import { describe, expect, it } from 'vitest';
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
