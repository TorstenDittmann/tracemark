// Click and form submit autocapture: `$autocapture` events describing the element, never what
// was typed into it, and `$heatmap_click` events with just where a click landed. See
// docs/autocapture.md and docs/heatmaps.md for the events' shape.
import type { Properties } from './properties';

/** Elements whose clicks are captured; a click inside one counts as a click on it. */
const CLICKABLE = 'a,button,input[type=submit],input[type=button],[role=button],[data-tm-capture]';
const MAX_TEXT = 100;
const MAX_ATTR = 100;
const MAX_ATTRS = 5;
// Card numbers and US social security numbers are dropped from element text.
const SENSITIVE_TEXT = /\b(?:\d[ -]?){13,19}\b|\b\d{3}-\d{2}-\d{4}\b/;

/** Heatmap clicks closer together than this are dropped, and at most this many are sent per page. */
const HEATMAP_GAP_MS = 100;
const HEATMAP_MAX = 100;

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Fields that are never captured, even when clicked or marked with `data-tm-capture`. */
function sensitive(el: Element): boolean {
	const type = (el.getAttribute('type') ?? '').toLowerCase();
	const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
	return (
		type === 'password' || type === 'hidden' || ac.startsWith('cc-') || ac.includes('password')
	);
}

/** Up to three levels of `tag#id` or `tag.class.class`, stopping at the first id. */
function selector(el: Element): string {
	const parts: string[] = [];
	for (let node: Element | null = el; node && parts.length < 3; node = node.parentElement) {
		const tag = node.tagName.toLowerCase();
		if (tag === 'html' || tag === 'body') break;
		if (node.id && /^[\w-]+$/.test(node.id)) {
			parts.unshift(`${tag}#${node.id}`);
			break;
		}
		const classes = [...node.classList].filter((c) => /^[\w-]+$/.test(c)).slice(0, 2);
		parts.unshift(tag + classes.map((c) => `.${c}`).join(''));
	}
	return parts.join(' > ');
}

/** Visible text of an element: its label for inputs, never their value. */
function text(el: Element | null | undefined): string {
	if (!el) return '';
	const label = el.getAttribute('aria-label') ?? el.getAttribute('title');
	const raw = label ?? (el.tagName === 'INPUT' ? '' : (el.textContent ?? ''));
	const t = raw.replace(/\s+/g, ' ').trim();
	return SENSITIVE_TEXT.test(t) ? '' : cap(t, MAX_TEXT);
}

/** The `$autocapture` properties for a click or submit on `el`, or `undefined` to skip it. */
export function describe(
	type: 'click' | 'submit',
	el: Element,
	submitter?: Element | null
): Properties | undefined {
	if (el.closest('[data-tm-no-capture]') || sensitive(el)) return;
	const p: Properties = {
		$event_type: type,
		$el_tag: el.tagName.toLowerCase(),
		$el_selector: selector(el)
	};
	const t = text(type === 'submit' && !el.getAttribute('aria-label') ? submitter : el);
	if (t) p.$el_text = t;
	const href = el.getAttribute('href');
	if (href) p.$el_href = cap(href, 2 * MAX_ATTR);
	let n = 0;
	for (const attr of el.attributes) {
		if (n >= MAX_ATTRS) break;
		if (attr.name.startsWith('data-') && !attr.name.startsWith('data-tm-')) {
			p[`$el_attr__${attr.name}`] = cap(attr.value, MAX_ATTR);
			n++;
		}
	}
	return p;
}

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;

/**
 * Where a click landed, as fractions of the document's width and height, so a heatmap lines up
 * whatever the page was scrolled to. Keyboard and scripted clicks have no position (`detail` 0).
 */
export function position(e: MouseEvent): Properties | undefined {
	const d = document.documentElement;
	const w = d.scrollWidth;
	const h = d.scrollHeight;
	if (!e.detail || !w || !h) return;
	return { $click_x: round(e.pageX / w), $click_y: round(e.pageY / h), $document_height: h };
}

/**
 * Listens for clicks and submits on `document`; returns a function that stops listening. With
 * `heatmaps`, clicks that are not autocaptured are sent as `$heatmap_click` with `lite` set.
 */
export function listen(
	clicks: boolean,
	forms: boolean,
	heatmaps: boolean,
	emit: (event: string, properties: Properties, lite?: boolean) => void
): () => void {
	const target = (e: Event) => {
		const t = e.composedPath?.()[0] ?? e.target;
		return t instanceof Element ? t : null;
	};
	let last = 0;
	let sent = 0;
	let page = '';
	const onClick = (e: Event) => {
		const t = target(e);
		if (!t || sensitive(t) || t.closest('[data-tm-no-capture]')) return;
		const el = t.closest(CLICKABLE);
		const pos = position(e as MouseEvent);
		if (clicks && el) {
			const p = describe('click', el);
			if (p) emit('$autocapture', { ...p, ...pos });
			return;
		}
		if (!heatmaps || !pos) return;
		const now = Date.now();
		if (page !== location.pathname) {
			page = location.pathname;
			sent = 0;
		}
		if (now - last < HEATMAP_GAP_MS || sent >= HEATMAP_MAX) return;
		last = now;
		sent++;
		emit('$heatmap_click', { ...pos, $el_selector: selector(el ?? t) }, true);
	};
	const onSubmit = (e: Event) => {
		const el = target(e);
		if (!el) return;
		const p = describe('submit', el, (e as SubmitEvent).submitter);
		if (p) emit('$autocapture', p);
	};
	if (clicks || heatmaps) document.addEventListener('click', onClick, true);
	if (forms) document.addEventListener('submit', onSubmit, true);
	return () => {
		document.removeEventListener('click', onClick, true);
		document.removeEventListener('submit', onSubmit, true);
	};
}
