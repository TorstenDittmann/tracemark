# Frameworks

The browser SDK (`@tracemark/browser`) and the Node SDK (`@tracemark/node`) work in any
framework. These packages and recipes cover the common setups.

## React: `@tracemark/react`

```tsx
import { tracemark } from '@tracemark/browser';
import { createFlags } from '@tracemark/browser/flags';
import { TracemarkProvider, useFeatureFlag, useFeatureFlagPayload } from '@tracemark/react';

const flags = createFlags();

export function App() {
  return (
    <TracemarkProvider
      client={tracemark}
      options={{ apiKey: 'fp_pub_…', host: 'https://ingest.example.com' }}
      flags={flags}
    >
      <Pricing />
    </TracemarkProvider>
  );
}

function Pricing() {
  const variant = useFeatureFlag('pricing-page'); // 'control' | 'cheaper' | false
  const payload = useFeatureFlagPayload<{ price: number }>('pricing-page');
  return variant === 'cheaper' ? <Cheaper price={payload?.price} /> : <Current />;
}
```

- `TracemarkProvider` initializes the client once in the browser if you pass `options`, and adds
  the flags plugin. Without `client` it uses the default `tracemark` client.
- `useTracemark()` returns the client for `capture`, `identify` and the rest.
- `useFeatureFlag(key)`, `useFeatureFlagEnabled(key)` and `useFeatureFlagPayload(key)` re-render
  when flags change, and record a `$feature_flag_called` exposure once per person and value.
- `useFlags()` returns the plugin itself, for `reload()` or `setPersonProperties()`.

### Error boundaries

Pass the errors plugin to the provider and wrap parts of your tree in `TracemarkErrorBoundary`:

```tsx
import { createErrors } from '@tracemark/browser/errors';
import { TracemarkErrorBoundary, reactErrorHandler } from '@tracemark/react';

const errors = createErrors({ release: '1.4.0' });

<TracemarkProvider options={options} flags={flags} errors={errors}>
  <TracemarkErrorBoundary fallback={({ reset }) => <button onClick={reset}>Try again</button>}>
    <Checkout />
  </TracemarkErrorBoundary>
</TracemarkProvider>;

// React 19 roots also report errors no boundary caught:
createRoot(el, { onUncaughtError: reactErrorHandler(errors) });
```

The boundary captures what its children throw while rendering, with the component stack as
`$react_component_stack`, and shows `fallback`. `useErrors()` returns the plugin.

## Next.js (App Router): `@tracemark/next`

```tsx
// lib/tracemark.ts (server only)
import { Tracemark } from '@tracemark/node';
export const tracemark = new Tracemark({
  apiKey: process.env.NEXT_PUBLIC_TRACEMARK_KEY!,
  host: process.env.NEXT_PUBLIC_TRACEMARK_HOST!,
  secretKey: process.env.TRACEMARK_SECRET_KEY, // local evaluation, optional
  release: process.env.NEXT_PUBLIC_RELEASE
});

// app/layout.tsx
import { cookies } from 'next/headers';
import { flagsBootstrap } from '@tracemark/next/server';
import { TracemarkNextProvider } from '@tracemark/next';

export default async function RootLayout({ children }) {
  const user = await currentUser();
  const bootstrap = await flagsBootstrap(tracemark, await cookies(), user?.id);
  return (
    <html><body>
      <TracemarkNextProvider
        options={{ apiKey: process.env.NEXT_PUBLIC_TRACEMARK_KEY!, host: process.env.NEXT_PUBLIC_TRACEMARK_HOST! }}
        bootstrap={bootstrap}
        distinctId={user?.id}
        errors={{ release: process.env.NEXT_PUBLIC_RELEASE }}
      >
        {children}
      </TracemarkNextProvider>
    </body></html>
  );
}
```

- `TracemarkNextProvider` sets up the browser SDK with the flags and errors plugins, and keeps
  the visitor's id in a cookie (`persistence: 'cookie'`) so the server can read it. Page views
  follow client-side navigation on their own. The hooks from `@tracemark/react` work inside it.
- `flagsBootstrap(client, cookies, distinctId?)` evaluates every flag for the signed-in user, or
  the visitor in the cookie, so the first render shows the right variant. It returns nothing for
  a first-time visitor. `tracemarkScope(client, await cookies())` gives the same person's
  `getFlag`, `isEnabled` and `capture` in server components and route handlers.
- Errors: `useCaptureException(error)` in `error.tsx` captures what the page shows (pass the
  errors plugin in `global-error.tsx`, which renders outside the provider). For server errors,
  add to `instrumentation.ts`:

```ts
import { createOnRequestError } from '@tracemark/next/server';
import { tracemark } from './lib/tracemark';
export const onRequestError = createOnRequestError(tracemark);
```

## Svelte and SvelteKit: `@tracemark/svelte`

Stores that work with `$` in Svelte 4 and 5 components:

```svelte
<script lang="ts">
  import { featureFlag, featureFlagPayload } from '@tracemark/svelte';
  import { flags } from '$lib/tracemark';

  const pricing = featureFlag(flags, 'pricing-page');
  const payload = featureFlagPayload<{ price: number }>(flags, 'pricing-page');
</script>

{#if $pricing === 'cheaper'}<Cheaper price={$payload?.price} />{:else}<Current />{/if}
```

`featureFlag` records an exposure for each value while something is subscribed;
`featureFlagEnabled` and `featureFlagPayload` derive from it, and `allFlags` reads every flag
without recording anything.

Svelte 5's `<svelte:boundary>` captures render errors with `boundaryError` from
`@tracemark/svelte` and the errors plugin:

```svelte
<svelte:boundary onerror={boundaryError(errors)}>
  <Checkout />
  {#snippet failed(error, reset)}<button onclick={reset}>Try again</button>{/snippet}
</svelte:boundary>
```

## SvelteKit: `@tracemark/sveltekit`

```ts
// src/lib/server/tracemark.ts
import { Tracemark } from '@tracemark/node';
export const tracemark = new Tracemark({ apiKey, host, secretKey, release });

// src/hooks.server.ts
import { tracemarkHandle, tracemarkHandleError } from '@tracemark/sveltekit/server';
export const handle = tracemarkHandle(tracemark, { distinctId: (event) => event.locals.user?.id });
export const handleError = tracemarkHandleError(tracemark);

// src/routes/+layout.server.ts
import { flagsBootstrap } from '@tracemark/sveltekit/server';
export const load = async (event) => ({ flags: await flagsBootstrap(event) });

// src/hooks.client.ts
import { tracemark } from '@tracemark/browser';
import { createErrors } from '@tracemark/browser/errors';
import { tracemarkClientHandleError } from '@tracemark/sveltekit';
export const errors = createErrors({ release });
tracemark.init({ apiKey: 'fp_pub_…', host: 'https://tracemark.example.com', persistence: 'cookie' });
tracemark.use(errors);
export const handleError = tracemarkClientHandleError(errors);
```

- `tracemarkHandle` sets `event.locals.tracemark` to the request's person: your `distinctId`
  callback, or the visitor id the browser SDK keeps in its cookie (use `persistence: 'cookie'`).
  Type it in `src/app.d.ts` with `tracemark: import('@tracemark/node').TracemarkScope` in `Locals`.
  Combine it with your own hooks using `sequence()`.
- `flagsBootstrap(event)` returns that person's flags for `createFlags({ bootstrap: data.flags })`.
  During server rendering the `@tracemark/svelte` stores keep that bootstrap.
- `tracemarkHandleError` and `tracemarkClientHandleError` capture unexpected errors, not 404s or
  errors thrown with `error()`, then return what the function you pass returns. They work with
  SvelteKit 2 and 3.

## Vue: `@tracemark/vue`

```ts
// main.ts
import { createErrors } from '@tracemark/browser/errors';
import { createFlags } from '@tracemark/browser/flags';
import { createTracemark } from '@tracemark/vue';

const app = createApp(App);
app.use(
  createTracemark({
    options: { apiKey: 'fp_pub_…', host: 'https://tracemark.example.com' },
    flags: createFlags(),
    errors: createErrors({ release })
  })
);
```

```vue
<script setup lang="ts">
import { useFeatureFlag, useFeatureFlagEnabled, useTracemark } from '@tracemark/vue';
const pricing = useFeatureFlag('pricing-page'); // Ref: variant, true, or false
const beta = useFeatureFlagEnabled('beta'); // ComputedRef<boolean>
const tracemark = useTracemark();
</script>

<template>
  <CheaperPricing v-if="pricing === 'cheaper'" />
  <button v-if="beta" @click="tracemark.capture('beta_clicked')">Try the beta</button>
</template>
```

- `useFeatureFlag` records a `$feature_flag_called` exposure for each value a mounted component
  shows; `useFeatureFlagPayload` returns the flag's JSON payload.
- With `errors`, the plugin captures errors from components through `app.config.errorHandler`
  and still calls a handler you set before installing it.
- Setup only runs in the browser, so the plugin also works with server rendering, where the
  composables hold the flags' bootstrap values.

## Nuxt: `@tracemark/nuxt`

On the server, `@tracemark/nuxt` gives each request a scope, bootstraps the browser's flags and
captures errors. In the browser, use `@tracemark/vue`.

```ts
// server/utils/tracemark.ts
import { Tracemark } from '@tracemark/node';
export const tracemark = new Tracemark({ apiKey, host, secretKey, release });

// server/middleware/tracemark.ts
import { tracemarkMiddleware } from '@tracemark/nuxt';
export default defineEventHandler(tracemarkMiddleware(tracemark));

// server/plugins/tracemark.ts
import { tracemarkErrorHook } from '@tracemark/nuxt';
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', tracemarkErrorHook(tracemark));
  nitroApp.hooks.hook('close', () => tracemark.shutdown());
});

// app/plugins/tracemark.ts
import { createErrors } from '@tracemark/browser/errors';
import { createFlags, type FlagsSnapshot } from '@tracemark/browser/flags';
import { flagsBootstrap } from '@tracemark/nuxt';
import { createTracemark } from '@tracemark/vue';
export default defineNuxtPlugin(async (nuxtApp) => {
  const bootstrap = useState<FlagsSnapshot | undefined>('tracemark-flags');
  if (import.meta.server) bootstrap.value = await flagsBootstrap(useRequestEvent());
  nuxtApp.vueApp.use(
    createTracemark({
      options: { apiKey: 'fp_pub_…', host: 'https://tracemark.example.com', persistence: 'cookie' },
      flags: createFlags({ bootstrap: bootstrap.value }),
      errors: createErrors({ release })
    })
  );
});
```

- `tracemarkMiddleware` sets `event.context.tracemark` (with `getFlag`, `capture` and friends) to
  the request's person: your `distinctId` callback, or the visitor id the browser SDK keeps in its
  cookie (use `persistence: 'cookie'`). It works with h3 1 (Nuxt 3 and 4) and h3 2.
- `flagsBootstrap(event)` evaluates that person's flags on the server, so pages render with the
  right variant and no flicker.
- `tracemarkErrorHook` captures unexpected server errors, not 4xx responses.

## Astro: `@tracemark/astro`

```js
// astro.config.mjs
import tracemark from '@tracemark/astro';
export default defineConfig({
  integrations: [
    tracemark({ apiKey: 'fp_pub_…', host: 'https://tracemark.example.com', errors: true })
  ]
});
```

The integration adds the browser SDK to every page; page views are captured on load and on
client-side navigations, including view transitions. `errors: true` (or `{ release, ignore }`)
adds the errors plugin. The options end up in the page, so they must be plain JSON.

For server-rendered pages and endpoints, add the middleware:

```ts
// src/middleware.ts
import { Tracemark } from '@tracemark/node';
import { tracemarkMiddleware } from '@tracemark/astro/middleware';
const tracemark = new Tracemark({ apiKey, host, secretKey, release });
export const onRequest = tracemarkMiddleware(tracemark, {
  distinctId: (context) => context.locals.user?.id
});
```

```astro
---
const cheaper = (await Astro.locals.tracemark.getFlag('pricing-page')) === 'cheaper';
---
{cheaper ? <CheaperPricing /> : <Pricing />}
```

Type `Astro.locals.tracemark` in `src/env.d.ts` with
`tracemark: import('@tracemark/node').TracemarkScope` in `App.Locals`. Errors thrown while
rendering are captured with the request's URL and person; `flagsBootstrap(Astro)` returns the
person's flags for client code.

## Node servers: Hono, Express, Fastify and Elysia

Create one `Tracemark` per process and add the middleware:

```ts
import { Tracemark } from '@tracemark/node';
const tracemark = new Tracemark({ apiKey, host, secretKey, release });

// Hono
import { tracemark as tracemarkMiddleware, getTracemark } from '@tracemark/node/hono';
app.use(tracemarkMiddleware(tracemark, { distinctId: (c) => c.get('user')?.id }));
app.get('/pricing', async (c) => {
  const fp = getTracemark(c);
  return c.json({ variant: await fp.getFlag('pricing-page') });
});

// Express
import { tracemark as tracemarkMiddleware, tracemarkErrorHandler } from '@tracemark/node/express';
app.use(tracemarkMiddleware(tracemark, { distinctId: (req) => req.user?.id }));
app.get('/pricing', async (req, res) => {
  res.json({ variant: await req.tracemark?.getFlag('pricing-page') });
});
app.use(tracemarkErrorHandler(tracemark)); // after your routes, before your own error handler

// Fastify: the plugin applies to every route, including ones registered in child plugins
import { tracemark as tracemarkPlugin } from '@tracemark/node/fastify';
await app.register(tracemarkPlugin(tracemark, { distinctId: (request) => request.headers['x-user-id'] }));
app.get('/pricing', async (request) => ({ variant: await request.tracemark.getFlag('pricing-page') }));

// Elysia (Bun): handlers get the scope as `tracemark` in their context
import { tracemark as tracemarkPlugin } from '@tracemark/node/elysia';
const app = new Elysia()
  .use(tracemarkPlugin(tracemark))
  .get('/pricing', async ({ tracemark }) => ({ variant: await tracemark.getFlag('pricing-page') }));

process.on('SIGTERM', async () => {
  await tracemark.shutdown();
  process.exit(0);
});
```

Each request gets a scope with `capture`, `captureException`, `getFlag`, `isEnabled`,
`getPayload` and `getAllFlags` for its person: your `distinctId` callback, or the visitor id the
browser SDK keeps in its cookie (`persistence: 'cookie'`). Without either, flags read as off.
Errors a handler throws are captured with the request's URL, method and person (Elysia leaves out
404s, validation and parse errors); pass
`captureErrors: false` to leave them alone. For other frameworks, `tracemark.scope(distinctId)`
and `tracemark.distinctIdFromCookie(cookieHeader)` are the same building blocks.

`getAllFlags` records no exposures; use `getFlag` or `isEnabled` where the value actually changes
what someone sees, so experiments count them. With a `secretKey`, flags that only depend on
properties you pass are evaluated in process with no request.
