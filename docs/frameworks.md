# Frameworks

The browser SDK (`@footprint/browser`) and the Node SDK (`@footprint/node`) work in any
framework. These packages and recipes cover the common setups.

## React: `@footprint/react`

```tsx
import { footprint } from '@footprint/browser';
import { createFlags } from '@footprint/browser/flags';
import { FootprintProvider, useFeatureFlag, useFeatureFlagPayload } from '@footprint/react';

const flags = createFlags();

export function App() {
  return (
    <FootprintProvider
      client={footprint}
      options={{ apiKey: 'fp_pub_…', host: 'https://ingest.example.com' }}
      flags={flags}
    >
      <Pricing />
    </FootprintProvider>
  );
}

function Pricing() {
  const variant = useFeatureFlag('pricing-page'); // 'control' | 'cheaper' | false
  const payload = useFeatureFlagPayload<{ price: number }>('pricing-page');
  return variant === 'cheaper' ? <Cheaper price={payload?.price} /> : <Current />;
}
```

- `FootprintProvider` initializes the client once in the browser if you pass `options`, and adds
  the flags plugin. Without `client` it uses the default `footprint` client.
- `useFootprint()` returns the client for `capture`, `identify` and the rest.
- `useFeatureFlag(key)`, `useFeatureFlagEnabled(key)` and `useFeatureFlagPayload(key)` re-render
  when flags change, and record a `$feature_flag_called` exposure once per person and value.
- `useFlags()` returns the plugin itself, for `reload()` or `setPersonProperties()`.

### Error boundaries

Pass the errors plugin to the provider and wrap parts of your tree in `FootprintErrorBoundary`:

```tsx
import { createErrors } from '@footprint/browser/errors';
import { FootprintErrorBoundary, reactErrorHandler } from '@footprint/react';

const errors = createErrors({ release: '1.4.0' });

<FootprintProvider options={options} flags={flags} errors={errors}>
  <FootprintErrorBoundary fallback={({ reset }) => <button onClick={reset}>Try again</button>}>
    <Checkout />
  </FootprintErrorBoundary>
</FootprintProvider>;

// React 19 roots also report errors no boundary caught:
createRoot(el, { onUncaughtError: reactErrorHandler(errors) });
```

The boundary captures what its children throw while rendering, with the component stack as
`$react_component_stack`, and shows `fallback`. `useErrors()` returns the plugin.

## Next.js (App Router): `@footprint/next`

```tsx
// lib/footprint.ts (server only)
import { Footprint } from '@footprint/node';
export const footprint = new Footprint({
  apiKey: process.env.NEXT_PUBLIC_FOOTPRINT_KEY!,
  host: process.env.NEXT_PUBLIC_FOOTPRINT_HOST!,
  secretKey: process.env.FOOTPRINT_SECRET_KEY, // local evaluation, optional
  release: process.env.NEXT_PUBLIC_RELEASE
});

// app/layout.tsx
import { cookies } from 'next/headers';
import { flagsBootstrap } from '@footprint/next/server';
import { FootprintNextProvider } from '@footprint/next';

export default async function RootLayout({ children }) {
  const user = await currentUser();
  const bootstrap = await flagsBootstrap(footprint, await cookies(), user?.id);
  return (
    <html><body>
      <FootprintNextProvider
        options={{ apiKey: process.env.NEXT_PUBLIC_FOOTPRINT_KEY!, host: process.env.NEXT_PUBLIC_FOOTPRINT_HOST! }}
        bootstrap={bootstrap}
        distinctId={user?.id}
        errors={{ release: process.env.NEXT_PUBLIC_RELEASE }}
      >
        {children}
      </FootprintNextProvider>
    </body></html>
  );
}
```

- `FootprintNextProvider` sets up the browser SDK with the flags and errors plugins, and keeps
  the visitor's id in a cookie (`persistence: 'cookie'`) so the server can read it. Page views
  follow client-side navigation on their own. The hooks from `@footprint/react` work inside it.
- `flagsBootstrap(client, cookies, distinctId?)` evaluates every flag for the signed-in user, or
  the visitor in the cookie, so the first render shows the right variant. It returns nothing for
  a first-time visitor. `footprintScope(client, await cookies())` gives the same person's
  `getFlag`, `isEnabled` and `capture` in server components and route handlers.
- Errors: `useCaptureException(error)` in `error.tsx` captures what the page shows (pass the
  errors plugin in `global-error.tsx`, which renders outside the provider). For server errors,
  add to `instrumentation.ts`:

```ts
import { createOnRequestError } from '@footprint/next/server';
import { footprint } from './lib/footprint';
export const onRequestError = createOnRequestError(footprint);
```

## Svelte and SvelteKit: `@footprint/svelte`

Stores that work with `$` in Svelte 4 and 5 components:

```svelte
<script lang="ts">
  import { featureFlag, featureFlagPayload } from '@footprint/svelte';
  import { flags } from '$lib/footprint';

  const pricing = featureFlag(flags, 'pricing-page');
  const payload = featureFlagPayload<{ price: number }>(flags, 'pricing-page');
</script>

{#if $pricing === 'cheaper'}<Cheaper price={$payload?.price} />{:else}<Current />{/if}
```

`featureFlag` records an exposure for each value while something is subscribed;
`featureFlagEnabled` and `featureFlagPayload` derive from it, and `allFlags` reads every flag
without recording anything.

Svelte 5's `<svelte:boundary>` captures render errors with `boundaryError` from
`@footprint/svelte` and the errors plugin:

```svelte
<svelte:boundary onerror={boundaryError(errors)}>
  <Checkout />
  {#snippet failed(error, reset)}<button onclick={reset}>Try again</button>{/snippet}
</svelte:boundary>
```

## SvelteKit: `@footprint/sveltekit`

```ts
// src/lib/server/footprint.ts
import { Footprint } from '@footprint/node';
export const footprint = new Footprint({ apiKey, host, secretKey, release });

// src/hooks.server.ts
import { footprintHandle, footprintHandleError } from '@footprint/sveltekit/server';
export const handle = footprintHandle(footprint, { distinctId: (event) => event.locals.user?.id });
export const handleError = footprintHandleError(footprint);

// src/routes/+layout.server.ts
import { flagsBootstrap } from '@footprint/sveltekit/server';
export const load = async (event) => ({ flags: await flagsBootstrap(event) });

// src/hooks.client.ts
import { footprint } from '@footprint/browser';
import { createErrors } from '@footprint/browser/errors';
import { footprintClientHandleError } from '@footprint/sveltekit';
export const errors = createErrors({ release });
footprint.init({ apiKey: 'fp_pub_…', host: 'https://footprint.example.com', persistence: 'cookie' });
footprint.use(errors);
export const handleError = footprintClientHandleError(errors);
```

- `footprintHandle` sets `event.locals.footprint` to the request's person: your `distinctId`
  callback, or the visitor id the browser SDK keeps in its cookie (use `persistence: 'cookie'`).
  Type it in `src/app.d.ts` with `footprint: import('@footprint/node').FootprintScope` in `Locals`.
  Combine it with your own hooks using `sequence()`.
- `flagsBootstrap(event)` returns that person's flags for `createFlags({ bootstrap: data.flags })`.
  During server rendering the `@footprint/svelte` stores keep that bootstrap.
- `footprintHandleError` and `footprintClientHandleError` capture unexpected errors, not 404s or
  errors thrown with `error()`, then return what the function you pass returns. They work with
  SvelteKit 2 and 3.

## Vue: `@footprint/vue`

```ts
// main.ts
import { createErrors } from '@footprint/browser/errors';
import { createFlags } from '@footprint/browser/flags';
import { createFootprint } from '@footprint/vue';

const app = createApp(App);
app.use(
  createFootprint({
    options: { apiKey: 'fp_pub_…', host: 'https://footprint.example.com' },
    flags: createFlags(),
    errors: createErrors({ release })
  })
);
```

```vue
<script setup lang="ts">
import { useFeatureFlag, useFeatureFlagEnabled, useFootprint } from '@footprint/vue';
const pricing = useFeatureFlag('pricing-page'); // Ref: variant, true, or false
const beta = useFeatureFlagEnabled('beta'); // ComputedRef<boolean>
const footprint = useFootprint();
</script>

<template>
  <CheaperPricing v-if="pricing === 'cheaper'" />
  <button v-if="beta" @click="footprint.capture('beta_clicked')">Try the beta</button>
</template>
```

- `useFeatureFlag` records a `$feature_flag_called` exposure for each value a mounted component
  shows; `useFeatureFlagPayload` returns the flag's JSON payload.
- With `errors`, the plugin captures errors from components through `app.config.errorHandler`
  and still calls a handler you set before installing it.
- Setup only runs in the browser, so the plugin also works with server rendering, where the
  composables hold the flags' bootstrap values.

## Nuxt: `@footprint/nuxt`

On the server, `@footprint/nuxt` gives each request a scope, bootstraps the browser's flags and
captures errors. In the browser, use `@footprint/vue`.

```ts
// server/utils/footprint.ts
import { Footprint } from '@footprint/node';
export const footprint = new Footprint({ apiKey, host, secretKey, release });

// server/middleware/footprint.ts
import { footprintMiddleware } from '@footprint/nuxt';
export default defineEventHandler(footprintMiddleware(footprint));

// server/plugins/footprint.ts
import { footprintErrorHook } from '@footprint/nuxt';
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', footprintErrorHook(footprint));
  nitroApp.hooks.hook('close', () => footprint.shutdown());
});

// app/plugins/footprint.ts
import { createErrors } from '@footprint/browser/errors';
import { createFlags, type FlagsSnapshot } from '@footprint/browser/flags';
import { flagsBootstrap } from '@footprint/nuxt';
import { createFootprint } from '@footprint/vue';
export default defineNuxtPlugin(async (nuxtApp) => {
  const bootstrap = useState<FlagsSnapshot | undefined>('footprint-flags');
  if (import.meta.server) bootstrap.value = await flagsBootstrap(useRequestEvent());
  nuxtApp.vueApp.use(
    createFootprint({
      options: { apiKey: 'fp_pub_…', host: 'https://footprint.example.com', persistence: 'cookie' },
      flags: createFlags({ bootstrap: bootstrap.value }),
      errors: createErrors({ release })
    })
  );
});
```

- `footprintMiddleware` sets `event.context.footprint` (with `getFlag`, `capture` and friends) to
  the request's person: your `distinctId` callback, or the visitor id the browser SDK keeps in its
  cookie (use `persistence: 'cookie'`). It works with h3 1 (Nuxt 3 and 4) and h3 2.
- `flagsBootstrap(event)` evaluates that person's flags on the server, so pages render with the
  right variant and no flicker.
- `footprintErrorHook` captures unexpected server errors, not 4xx responses.

## Astro: `@footprint/astro`

```js
// astro.config.mjs
import footprint from '@footprint/astro';
export default defineConfig({
  integrations: [
    footprint({ apiKey: 'fp_pub_…', host: 'https://footprint.example.com', errors: true })
  ]
});
```

The integration adds the browser SDK to every page; page views are captured on load and on
client-side navigations, including view transitions. `errors: true` (or `{ release, ignore }`)
adds the errors plugin. The options end up in the page, so they must be plain JSON.

For server-rendered pages and endpoints, add the middleware:

```ts
// src/middleware.ts
import { Footprint } from '@footprint/node';
import { footprintMiddleware } from '@footprint/astro/middleware';
const footprint = new Footprint({ apiKey, host, secretKey, release });
export const onRequest = footprintMiddleware(footprint, {
  distinctId: (context) => context.locals.user?.id
});
```

```astro
---
const cheaper = (await Astro.locals.footprint.getFlag('pricing-page')) === 'cheaper';
---
{cheaper ? <CheaperPricing /> : <Pricing />}
```

Type `Astro.locals.footprint` in `src/env.d.ts` with
`footprint: import('@footprint/node').FootprintScope` in `App.Locals`. Errors thrown while
rendering are captured with the request's URL and person; `flagsBootstrap(Astro)` returns the
person's flags for client code.

## Node servers: Hono, Express, Fastify and Elysia

Create one `Footprint` per process and add the middleware:

```ts
import { Footprint } from '@footprint/node';
const footprint = new Footprint({ apiKey, host, secretKey, release });

// Hono
import { footprint as footprintMiddleware, getFootprint } from '@footprint/node/hono';
app.use(footprintMiddleware(footprint, { distinctId: (c) => c.get('user')?.id }));
app.get('/pricing', async (c) => {
  const fp = getFootprint(c);
  return c.json({ variant: await fp.getFlag('pricing-page') });
});

// Express
import { footprint as footprintMiddleware, footprintErrorHandler } from '@footprint/node/express';
app.use(footprintMiddleware(footprint, { distinctId: (req) => req.user?.id }));
app.get('/pricing', async (req, res) => {
  res.json({ variant: await req.footprint?.getFlag('pricing-page') });
});
app.use(footprintErrorHandler(footprint)); // after your routes, before your own error handler

// Fastify: the plugin applies to every route, including ones registered in child plugins
import { footprint as footprintPlugin } from '@footprint/node/fastify';
await app.register(footprintPlugin(footprint, { distinctId: (request) => request.headers['x-user-id'] }));
app.get('/pricing', async (request) => ({ variant: await request.footprint.getFlag('pricing-page') }));

// Elysia (Bun): handlers get the scope as `footprint` in their context
import { footprint as footprintPlugin } from '@footprint/node/elysia';
const app = new Elysia()
  .use(footprintPlugin(footprint))
  .get('/pricing', async ({ footprint }) => ({ variant: await footprint.getFlag('pricing-page') }));

process.on('SIGTERM', async () => {
  await footprint.shutdown();
  process.exit(0);
});
```

Each request gets a scope with `capture`, `captureException`, `getFlag`, `isEnabled`,
`getPayload` and `getAllFlags` for its person: your `distinctId` callback, or the visitor id the
browser SDK keeps in its cookie (`persistence: 'cookie'`). Without either, flags read as off.
Errors a handler throws are captured with the request's URL, method and person (Elysia leaves out
404s, validation and parse errors); pass
`captureErrors: false` to leave them alone. For other frameworks, `footprint.scope(distinctId)`
and `footprint.distinctIdFromCookie(cookieHeader)` are the same building blocks.

`getAllFlags` records no exposures; use `getFlag` or `isEnabled` where the value actually changes
what someone sees, so experiments count them. With a `secretKey`, flags that only depend on
properties you pass are evaluated in process with no request.
