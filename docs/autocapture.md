# Autocapture and web vitals

Besides page views, the browser SDK can capture clicks, form submits and web vitals by itself. All three are off by default:

```ts
tracemark.init({
	apiKey: 'fp_pub_…',
	host: 'https://analytics.example.com',
	autocaptureClicks: true,
	autocaptureForms: true,
	autocaptureWebVitals: true
});
```

The framework packages pass these options through like any other.

PostHog turns click autocapture on by default; tracemark doesn't, so upgrading the SDK never starts collecting button text nobody asked for, and so projects that track events by hand don't get a stream of clicks they don't use. The code is in the core bundle either way: together the three add about 1.4 KB gzipped.

## Clicks and form submits

With `autocaptureClicks`, a click on one of these, or anywhere inside one, is captured:

- `<a>` and `<button>`
- `<input type="submit">` and `<input type="button">`
- any element with `role="button"`
- any element with a `data-tm-capture` attribute

With `autocaptureForms`, every form submit is captured too. Both send an `$autocapture` event with the usual page properties and:

| Property | Value |
| --- | --- |
| `$event_type` | `click` or `submit` |
| `$el_tag` | The element's tag, such as `button`, `a` or `form` |
| `$el_text` | Its text, whitespace collapsed and cut to 100 characters, or its `aria-label` or `title`. For a submit, the text of the button that submitted the form. |
| `$el_href` | A link's `href` attribute, as written |
| `$el_selector` | A short CSS selector: up to three levels of `tag#id` or `tag.class.class`, such as `nav#top > div.menu > a` |
| `$el_attr__data-*` | Up to five of the element's `data-*` attributes, except `data-tm-*` |

What is never captured:

- Anything inside an element with `data-tm-no-capture`. Put it on a section to leave the whole section out.
- What people type. Input values are never read, not even the label of a `<input type="submit">` (give it an `aria-label` to name it).
- Password and hidden fields, and fields with a `cc-*` or password `autocomplete`, even inside a `data-tm-capture` element.
- Text that looks like a card number or a US social security number: the event is sent without `$el_text`.

In the dashboard's Events list, `$autocapture` events read as `clicked 'Sign up'` or `submitted a form`. They are ordinary events everywhere else: chart clicks on one button in a trend or funnel step with a filter such as `$el_text = Sign up`, or `$el_selector` for buttons without text.

## Web vitals

With `autocaptureWebVitals`, the SDK measures [Core Web Vitals](https://web.dev/articles/vitals) with `PerformanceObserver` (no extra library) and sends them as one `$web_vitals` event per page view:

| Property | Metric | Unit |
| --- | --- | --- |
| `$web_vitals_LCP_value` | Largest Contentful Paint | ms |
| `$web_vitals_INP_value` | Interaction to Next Paint | ms |
| `$web_vitals_CLS_value` | Cumulative Layout Shift | unitless |
| `$web_vitals_FCP_value` | First Contentful Paint | ms |
| `$web_vitals_TTFB_value` | Time to First Byte | ms |

A metric the browser can't measure, or that didn't happen (INP on a page nobody interacted with), is left out. Safari and Firefox report no layout shifts, so their events have no CLS.

The event is sent when the page is hidden (a tab switch, closing the tab, or leaving the site; it goes out with `sendBeacon`), or on the next SPA navigation, whichever comes first, and only once per page view. Its `$current_url` and `$pathname` are those of the page that was measured, even when it is sent after navigating away.

On SPA navigations, LCP, FCP and TTFB belong to the first, full page load only. CLS and INP start again for each page, so later pages report just those two. Pages that load in a background tab report no LCP or FCP, as nobody saw them paint.

The Web page of a project shows the 75th percentile of each metric over the selected range, colored by Google's thresholds, and a breakdown by path:

| Metric | Good | Needs improvement | Poor |
| --- | --- | --- | --- |
| LCP | ≤ 2.5 s | ≤ 4 s | > 4 s |
| INP | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| FCP | ≤ 1.8 s | ≤ 3 s | > 3 s |
| TTFB | ≤ 800 ms | ≤ 1.8 s | > 1.8 s |

The page, country, device, browser and OS filters narrow the vitals too. Referrer, UTM, entry and exit page filters describe a session's start and don't apply to them.
