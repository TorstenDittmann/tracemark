# Click heatmaps

Heatmaps show where people click on a page. They are the lightweight alternative to session replay: no DOM snapshots, only a position and an element for each click. A project's Web page has them under **Heatmaps**.

## Turning them on

Clicks get a position when the browser SDK captures them. Turn on click autocapture, and optionally `heatmaps` for clicks anywhere on the page:

```ts
tracemark.init({
	apiKey: 'fp_pub_…',
	host: 'https://analytics.example.com',
	autocaptureClicks: true, // buttons and links, as $autocapture events
	heatmaps: true // everything else, as $heatmap_click events
});
```

With `autocaptureClicks` alone, the heatmap shows clicks on buttons, links and the other elements [click autocapture](autocapture.md#clicks-and-form-submits) covers. `heatmaps` adds clicks on anything else: text, images, cards that look like links but aren't. Those "dead clicks" are often the most telling part of a heatmap.

Both add about 0.3 KB gzipped to the core bundle.

## What is sent

Autocaptured clicks get these properties on top of [the usual ones](autocapture.md#clicks-and-form-submits):

| Property | Value |
| --- | --- |
| `$click_x` | Where the click landed across the page, from 0 (left edge) to 1 (right edge), rounded to 4 decimals |
| `$click_y` | Where it landed down the whole page, from 0 (top) to 1 (bottom), whatever it was scrolled to |
| `$document_height` | The page's full height in CSS pixels |

`$viewport_width` and `$viewport_height` come with every event already. Clicks from the keyboard (Enter on a focused button) or from scripts have no position, so they count for their element but not on the heatmap.

With `heatmaps`, a click that isn't autocaptured is sent as a `$heatmap_click` event with only `$click_x`, `$click_y`, `$document_height`, `$el_selector` (the clicked element, see the selector format in [autocapture](autocapture.md#clicks-and-form-submits)), `$pathname`, `$host`, the viewport size and the SDK version. No element text, no URL query string, no title or referrer. Clicks closer than 100 ms apart are dropped, and at most 100 are sent per page; they go out in the same batches as every other event.

The same exclusions as click autocapture apply: nothing inside `data-tm-no-capture`, and no clicks on password or hidden fields.

## In the dashboard

Pick a page from the most clicked paths, a date range and a device size. Layouts differ by screen width, so clicks are only drawn together with clicks from similar viewports:

| Device | Viewport width |
| --- | --- |
| Desktop | 1024 px and wider |
| Tablet | 768 to 1023 px |
| Mobile | up to 767 px |

Clicks are counted into a grid of 100 columns, with as many rows as keep the cells square on a page of the typical height, and drawn over the page. The page is loaded in a frame, at the typical viewport width of the clicks, from the origin the project's page views come from plus the path. Enter another URL to load a different one, such as a staging copy or a page behind a login you are signed in to.

**Most clicked elements** lists the elements clicked on the page, by selector and text, including clicks without a position. Rows from `$heatmap_click` read "Not a button or link".

Internal users are left out when the project [filters them](internal-users.md).

The frame is named `tracemark-heatmap`, and the browser SDK sends nothing from a window with that name, so looking at a heatmap never adds page views or clicks. The frame is sandboxed and can't navigate the dashboard or open popups.

## Allowing the dashboard to frame your site

Many sites don't allow other sites to show them in a frame. The heatmap is then drawn on a blank page of the same size, with a note saying why. To see your page behind the clicks, let your tracemark host frame it, with a `Content-Security-Policy` response header on the pages:

```
Content-Security-Policy: frame-ancestors 'self' https://analytics.example.com
```

and no `X-Frame-Options` header (browsers ignore it when `frame-ancestors` is set, but older ones don't). Add `frame-ancestors` to an existing policy rather than sending a second one. A site served over plain `http` can't be framed by a dashboard served over `https`.

The dashboard checks the headers of pages on origins the project's own events came from. It only fetches hosts with public addresses and doesn't follow redirects, so a page that redirects, or one on a private network, isn't checked; for those, and for any other URL, it only notices when the frame doesn't load within 10 seconds. If a page shows an error in the frame anyway, turn off **Show page**.
