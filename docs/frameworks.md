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

## Next.js (App Router)

The package is marked `'use client'`, so the provider can sit in your root layout. To render the
right variant on the first paint for signed-in people, evaluate flags on the server with the Node
SDK and pass them as the bootstrap:

```tsx
// lib/footprint.ts (server only)
import { Footprint } from '@footprint/node';
export const footprint = new Footprint({
  apiKey: process.env.FOOTPRINT_API_KEY!,
  host: process.env.FOOTPRINT_HOST!,
  secretKey: process.env.FOOTPRINT_SECRET_KEY // local evaluation, optional
});

// app/layout.tsx
const user = await currentUser();
const bootstrap = user ? await footprint.getAllFlagsAndPayloads(user.id) : undefined;
return <Providers bootstrap={bootstrap} userId={user?.id}>{children}</Providers>;

// app/providers.tsx
'use client';
export function Providers({ bootstrap, userId, children }) {
  const [flags] = useState(() => createFlags({ bootstrap }));
  useEffect(() => { if (userId) footprint.identify(userId); }, [userId]);
  return <FootprintProvider options={options} flags={flags}>{children}</FootprintProvider>;
}
```

The bootstrap is used until the browser's own `POST /flags` answers, so it only helps when the
browser identifies as the same person the server evaluated for.

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

In SvelteKit, initialize in the browser only, for example in `src/hooks.client.ts`:

```ts
import { footprint } from '@footprint/browser';
import { flags } from '$lib/footprint'; // export const flags = createFlags();
footprint.init({ apiKey: 'fp_pub_…', host: 'https://ingest.example.com' });
footprint.use(flags);
```

During server rendering the stores keep their initial value (the bootstrap, or `false`). To
bootstrap, evaluate in `+layout.server.ts` with `@footprint/node` as in the Next.js example and
create the flags with `createFlags({ bootstrap: data.flags })`.

## Node servers: Express, Hono and others

Create one `Footprint` per process, read flags per request, and flush on shutdown:

```ts
import { Footprint } from '@footprint/node';
const footprint = new Footprint({ apiKey, host, secretKey });

// Express
app.use(async (req, res, next) => {
  req.flags = req.user ? await footprint.getAllFlags(req.user.id) : {};
  next();
});

// Hono
app.use(async (c, next) => {
  const user = c.get('user');
  c.set('flags', user ? await footprint.getAllFlags(user.id) : {});
  await next();
});

process.on('SIGTERM', async () => {
  await footprint.shutdown();
  process.exit(0);
});
```

`getAllFlags` records no exposures; use `getFlag` or `isEnabled` where the value actually changes
what someone sees, so experiments count them. With a `secretKey`, flags that only depend on
properties you pass are evaluated in process with no request.
