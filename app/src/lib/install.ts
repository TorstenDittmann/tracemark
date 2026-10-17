// Step-by-step install guides for the onboarding, one per framework. Keep package names and APIs
// in step with the SDK packages and docs/.

export interface GuideContext {
	/** The project's public key. */
	key: string;
	/** The ingest host the SDKs send to. */
	host: string;
}

export interface GuideFile {
	/** Where the code goes, such as `app/layout.tsx`. */
	name: string;
	language: string;
	code: (ctx: GuideContext) => string;
}

export interface GuideStep {
	title: string;
	/** One or two sentences on what this step does and why. */
	body: string;
	/** npm packages to add; the guide shows the command for the reader's package manager. */
	packages?: string[];
	/** A command to run, for platforms without npm packages. */
	command?: string;
	files?: GuideFile[];
	/** Steps that add server-side flags, events or errors and can be skipped to get started. */
	optional?: boolean;
}

export type FrameworkCategory = 'meta' | 'frontend' | 'web' | 'backend' | 'other';

export interface Framework {
	id: string;
	label: string;
	category: FrameworkCategory;
	/** A few words shown under the name in the picker. */
	tagline: string;
	/** Key into BRAND_ICONS. */
	icon: string;
	steps: GuideStep[];
}

export const CATEGORIES: { id: FrameworkCategory; label: string }[] = [
	{ id: 'meta', label: 'Full-stack frameworks' },
	{ id: 'frontend', label: 'Frontend frameworks' },
	{ id: 'web', label: 'Websites' },
	{ id: 'backend', label: 'Servers' },
	{ id: 'other', label: 'Anything else' }
];

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export function installCommand(manager: PackageManager, packages: string[]): string {
	const list = packages.join(' ');
	return manager === 'npm' ? `npm install ${list}` : `${manager} add ${list}`;
}

const SERVER_CLIENT = ({ key, host }: GuideContext) => `import { Tracemark } from '@tracemark/node';

export const tracemark = new Tracemark({
  apiKey: '${key}',
  host: '${host}'
});`;

/** For servers: capture from a handler, then flush before the process exits. */
const nodeShutdown = `process.on('SIGTERM', async () => {
  await tracemark.shutdown();
  process.exit(0);
});`;

export const FRAMEWORKS: Framework[] = [
	{
		id: 'nextjs',
		label: 'Next.js',
		category: 'meta',
		tagline: 'App Router',
		icon: 'nextjs',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Next.js package wraps the browser SDK for client components and the Node SDK for the server.',
				packages: ['@tracemark/browser', '@tracemark/react', '@tracemark/next', '@tracemark/node']
			},
			{
				title: 'Add your keys',
				body: 'The public key is safe to ship to the browser, so both values use the NEXT_PUBLIC_ prefix.',
				files: [
					{
						name: '.env.local',
						language: 'sh',
						code: ({ key, host }) => `NEXT_PUBLIC_TRACEMARK_KEY=${key}
NEXT_PUBLIC_TRACEMARK_HOST=${host}`
					}
				]
			},
			{
				title: 'Wrap your root layout',
				body: 'The provider starts the SDK in the browser and captures a page view on every navigation. Hooks like useFeatureFlag work anywhere inside it.',
				files: [
					{
						name: 'app/layout.tsx',
						language: 'tsx',
						code: () => `import { TracemarkNextProvider } from '@tracemark/next';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TracemarkNextProvider
          options={{
            apiKey: process.env.NEXT_PUBLIC_TRACEMARK_KEY!,
            host: process.env.NEXT_PUBLIC_TRACEMARK_HOST!
          }}
        >
          {children}
        </TracemarkNextProvider>
      </body>
    </html>
  );
}`
					}
				]
			},
			{
				title: 'Capture server errors',
				body: 'Create one server client, then report errors from server components, route handlers and middleware.',
				optional: true,
				files: [
					{
						name: 'lib/tracemark.ts',
						language: 'ts',
						code: () => `import { Tracemark } from '@tracemark/node';

export const tracemark = new Tracemark({
  apiKey: process.env.NEXT_PUBLIC_TRACEMARK_KEY!,
  host: process.env.NEXT_PUBLIC_TRACEMARK_HOST!
});`
					},
					{
						name: 'instrumentation.ts',
						language: 'ts',
						code: () => `import { createOnRequestError } from '@tracemark/next/server';
import { tracemark } from './lib/tracemark';

export const onRequestError = createOnRequestError(tracemark);`
					}
				]
			}
		]
	},
	{
		id: 'nuxt',
		label: 'Nuxt',
		category: 'meta',
		tagline: 'Nuxt 3 and 4',
		icon: 'nuxt',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Vue plugin runs in the browser; the Nuxt package adds server middleware and error capture.',
				packages: ['@tracemark/browser', '@tracemark/vue', '@tracemark/nuxt', '@tracemark/node']
			},
			{
				title: 'Add the plugin',
				body: 'Page views are captured on load and on every route change. The cookie lets the server see the same visitor. On Nuxt 3, put it in plugins/ at the project root.',
				files: [
					{
						name: 'app/plugins/tracemark.ts',
						language: 'ts',
						code: ({ key, host }) => `import { createTracemark } from '@tracemark/vue';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(
    createTracemark({
      options: {
        apiKey: '${key}',
        host: '${host}',
        persistence: 'cookie'
      }
    })
  );
});`
					}
				]
			},
			{
				title: 'Add flags and errors on the server',
				body: 'Gives each request event.context.tracemark for flags and events, and captures unexpected server errors.',
				optional: true,
				files: [
					{ name: 'server/utils/tracemark.ts', language: 'ts', code: SERVER_CLIENT },
					{
						name: 'server/middleware/tracemark.ts',
						language: 'ts',
						code: () => `import { tracemarkMiddleware } from '@tracemark/nuxt';

export default defineEventHandler(tracemarkMiddleware(tracemark));`
					},
					{
						name: 'server/plugins/tracemark.ts',
						language: 'ts',
						code: () => `import { tracemarkErrorHook } from '@tracemark/nuxt';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', tracemarkErrorHook(tracemark));
  nitroApp.hooks.hook('close', () => tracemark.shutdown());
});`
					}
				]
			}
		]
	},
	{
		id: 'sveltekit',
		label: 'SvelteKit',
		category: 'meta',
		tagline: 'SvelteKit 2 and 3',
		icon: 'sveltekit',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The SvelteKit package adds hooks for both sides; the Svelte package gives you flag stores.',
				packages: [
					'@tracemark/browser',
					'@tracemark/svelte',
					'@tracemark/sveltekit',
					'@tracemark/node'
				]
			},
			{
				title: 'Start the SDK in the browser',
				body: 'Page views are captured on load and on every navigation, and unexpected errors are reported. The cookie lets your server hooks see the same visitor.',
				files: [
					{
						name: 'src/hooks.client.ts',
						language: 'ts',
						code: ({ key, host }) => `import { tracemark } from '@tracemark/browser';
import { createErrors } from '@tracemark/browser/errors';
import { tracemarkClientHandleError } from '@tracemark/sveltekit';

const errors = createErrors();

tracemark.init({
  apiKey: '${key}',
  host: '${host}',
  persistence: 'cookie'
});
tracemark.use(errors);

export const handleError = tracemarkClientHandleError(errors);`
					}
				]
			},
			{
				title: 'Add the server hooks',
				body: 'Gives each request event.locals.tracemark for flags and events, and captures unexpected server errors. Combine with your own hooks using sequence().',
				optional: true,
				files: [
					{ name: 'src/lib/server/tracemark.ts', language: 'ts', code: SERVER_CLIENT },
					{
						name: 'src/hooks.server.ts',
						language: 'ts',
						code: () => `import { tracemarkHandle, tracemarkHandleError } from '@tracemark/sveltekit/server';
import { tracemark } from '$lib/server/tracemark';

export const handle = tracemarkHandle(tracemark);
export const handleError = tracemarkHandleError(tracemark);`
					}
				]
			}
		]
	},
	{
		id: 'astro',
		label: 'Astro',
		category: 'meta',
		tagline: 'Static and server',
		icon: 'astro',
		steps: [
			{
				title: 'Install the integration',
				body: 'The integration adds the browser SDK to every page.',
				packages: ['@tracemark/browser', '@tracemark/astro']
			},
			{
				title: 'Add it to your config',
				body: 'Page views are captured on load and on client-side navigations, including view transitions. errors: true also reports uncaught errors.',
				files: [
					{
						name: 'astro.config.mjs',
						language: 'js',
						code: ({ key, host }) => `import { defineConfig } from 'astro/config';
import tracemark from '@tracemark/astro';

export default defineConfig({
  integrations: [
    tracemark({
      apiKey: '${key}',
      host: '${host}',
      errors: true
    })
  ]
});`
					}
				]
			},
			{
				title: 'Add the middleware for server pages',
				body: 'Gives server-rendered pages and endpoints Astro.locals.tracemark for flags, and captures errors thrown while rendering.',
				optional: true,
				packages: ['@tracemark/node'],
				files: [
					{
						name: 'src/middleware.ts',
						language: 'ts',
						code: ({ key, host }) => `import { Tracemark } from '@tracemark/node';
import { tracemarkMiddleware } from '@tracemark/astro/middleware';

const tracemark = new Tracemark({ apiKey: '${key}', host: '${host}' });

export const onRequest = tracemarkMiddleware(tracemark);`
					}
				]
			}
		]
	},
	{
		id: 'react-router',
		label: 'React Router',
		category: 'meta',
		tagline: 'v7 and Remix',
		icon: 'reactrouter',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The React package works in framework mode and in Remix; it only starts in the browser.',
				packages: ['@tracemark/browser', '@tracemark/react']
			},
			{
				title: 'Wrap your root route',
				body: 'The provider starts the SDK once in the browser and captures a page view on every navigation.',
				files: [
					{
						name: 'app/root.tsx',
						language: 'tsx',
						code: ({ key, host }) => `import { Outlet } from 'react-router';
import { TracemarkProvider } from '@tracemark/react';

export default function App() {
  return (
    <TracemarkProvider options={{ apiKey: '${key}', host: '${host}' }}>
      <Outlet />
    </TracemarkProvider>
  );
}`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'useTracemark() returns the client anywhere inside the provider.',
				optional: true,
				files: [
					{
						name: 'app/routes/pricing.tsx',
						language: 'tsx',
						code: () => `import { useTracemark } from '@tracemark/react';

export default function Pricing() {
  const tracemark = useTracemark();
  return <button onClick={() => tracemark.capture('upgrade_clicked')}>Upgrade</button>;
}`
					}
				]
			}
		]
	},
	{
		id: 'react',
		label: 'React',
		category: 'frontend',
		tagline: 'Vite and other SPAs',
		icon: 'react',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The React package adds a provider and hooks on top of the browser SDK.',
				packages: ['@tracemark/browser', '@tracemark/react']
			},
			{
				title: 'Wrap your app',
				body: 'The provider starts the SDK once and captures a page view on load and on every route change.',
				files: [
					{
						name: 'src/main.tsx',
						language: 'tsx',
						code: ({ key, host }) => `import { createRoot } from 'react-dom/client';
import { TracemarkProvider } from '@tracemark/react';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <TracemarkProvider options={{ apiKey: '${key}', host: '${host}' }}>
    <App />
  </TracemarkProvider>
);`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'useTracemark() returns the client anywhere inside the provider.',
				optional: true,
				files: [
					{
						name: 'src/Pricing.tsx',
						language: 'tsx',
						code: () => `import { useTracemark } from '@tracemark/react';

export function Pricing() {
  const tracemark = useTracemark();
  return <button onClick={() => tracemark.capture('upgrade_clicked')}>Upgrade</button>;
}`
					}
				]
			}
		]
	},
	{
		id: 'vue',
		label: 'Vue',
		category: 'frontend',
		tagline: 'Vue 3',
		icon: 'vue',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Vue package adds a plugin and composables on top of the browser SDK.',
				packages: ['@tracemark/browser', '@tracemark/vue']
			},
			{
				title: 'Install the plugin',
				body: 'Page views are captured on load and on every route change.',
				files: [
					{
						name: 'src/main.ts',
						language: 'ts',
						code: ({ key, host }) => `import { createApp } from 'vue';
import { createTracemark } from '@tracemark/vue';
import App from './App.vue';

const app = createApp(App);
app.use(
  createTracemark({
    options: { apiKey: '${key}', host: '${host}' }
  })
);
app.mount('#app');`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'useTracemark() returns the client in any component.',
				optional: true,
				files: [
					{
						name: 'src/components/Pricing.vue',
						language: 'vue',
						code: () => `<script setup lang="ts">
import { useTracemark } from '@tracemark/vue';
const tracemark = useTracemark();
</script>

<template>
  <button @click="tracemark.capture('upgrade_clicked')">Upgrade</button>
</template>`
					}
				]
			}
		]
	},
	{
		id: 'svelte',
		label: 'Svelte',
		category: 'frontend',
		tagline: 'Svelte 4 and 5',
		icon: 'svelte',
		steps: [
			{
				title: 'Install the SDK',
				body: 'Using SvelteKit? Pick SvelteKit instead for server hooks and error capture.',
				packages: ['@tracemark/browser', '@tracemark/svelte']
			},
			{
				title: 'Start the SDK',
				body: 'Initialize once before your app mounts. Page views are captured on load and on every route change.',
				files: [
					{
						name: 'src/main.ts',
						language: 'ts',
						code: ({ key, host }) => `import { mount } from 'svelte';
import { tracemark } from '@tracemark/browser';
import App from './App.svelte';

tracemark.init({ apiKey: '${key}', host: '${host}' });

mount(App, { target: document.getElementById('app')! });`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'Import the client wherever you need it.',
				optional: true,
				files: [
					{
						name: 'src/Pricing.svelte',
						language: 'svelte',
						code: () => `<script lang="ts">
  import { tracemark } from '@tracemark/browser';
</script>

<button onclick={() => tracemark.capture('upgrade_clicked')}>Upgrade</button>`
					}
				]
			}
		]
	},
	{
		id: 'angular',
		label: 'Angular',
		category: 'frontend',
		tagline: 'Standalone apps',
		icon: 'angular',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The browser SDK has no framework dependencies.',
				packages: ['@tracemark/browser']
			},
			{
				title: 'Start the SDK',
				body: 'Initialize once before bootstrapping. Page views are captured on load and on every router navigation.',
				files: [
					{
						name: 'src/main.ts',
						language: 'ts',
						code: ({
							key,
							host
						}) => `import { bootstrapApplication } from '@angular/platform-browser';
import { tracemark } from '@tracemark/browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

tracemark.init({ apiKey: '${key}', host: '${host}' });

bootstrapApplication(AppComponent, appConfig);`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'Import the client in any component or service.',
				optional: true,
				files: [
					{
						name: 'src/app/pricing.component.ts',
						language: 'ts',
						code: () => `import { Component } from '@angular/core';
import { tracemark } from '@tracemark/browser';

@Component({
  selector: 'app-pricing',
  template: '<button (click)="upgrade()">Upgrade</button>'
})
export class PricingComponent {
  upgrade() {
    tracemark.capture('upgrade_clicked');
  }
}`
					}
				]
			}
		]
	},
	{
		id: 'solid',
		label: 'Solid',
		category: 'frontend',
		tagline: 'SolidJS',
		icon: 'solid',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The browser SDK has no framework dependencies.',
				packages: ['@tracemark/browser']
			},
			{
				title: 'Start the SDK',
				body: 'Initialize once before rendering. Page views are captured on load and on every route change.',
				files: [
					{
						name: 'src/index.tsx',
						language: 'tsx',
						code: ({ key, host }) => `import { render } from 'solid-js/web';
import { tracemark } from '@tracemark/browser';
import App from './App';

tracemark.init({ apiKey: '${key}', host: '${host}' });

render(() => <App />, document.getElementById('root')!);`
					}
				]
			}
		]
	},
	{
		id: 'html',
		label: 'HTML',
		category: 'web',
		tagline: 'Script tag, no build',
		icon: 'html',
		steps: [
			{
				title: 'Add the snippet',
				body: 'Paste it before the closing </head> tag on every page, or in your site builder’s custom code setting. Page views are captured automatically.',
				files: [
					{
						name: 'index.html',
						language: 'html',
						code: ({
							key,
							host
						}) => `<script src="https://unpkg.com/@tracemark/browser/dist/tracemark.iife.js"></script>
<script>
  tracemark.init({ apiKey: '${key}', host: '${host}' });
</script>`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'The snippet puts tracemark on window, so any script on the page can use it.',
				optional: true,
				files: [
					{
						name: 'index.html',
						language: 'html',
						code: () => `<button onclick="tracemark.capture('upgrade_clicked')">Upgrade</button>`
					}
				]
			}
		]
	},
	{
		id: 'js',
		label: 'JavaScript',
		category: 'web',
		tagline: 'Any bundler',
		icon: 'js',
		steps: [
			{
				title: 'Install the SDK',
				body: 'Works with Vite, webpack, esbuild and anything else that bundles npm packages.',
				packages: ['@tracemark/browser']
			},
			{
				title: 'Start the SDK',
				body: 'Initialize once on page load. Page views are captured automatically, including client-side navigations.',
				files: [
					{
						name: 'src/main.ts',
						language: 'ts',
						code: ({ key, host }) => `import { tracemark } from '@tracemark/browser';

tracemark.init({
  apiKey: '${key}',
  host: '${host}',
  // cookieless: true, // store nothing on visitors' devices
});`
					}
				]
			},
			{
				title: 'Identify people',
				body: 'After someone signs in, link their events to your own user id.',
				optional: true,
				files: [
					{
						name: 'src/auth.ts',
						language: 'ts',
						code: () => `import { tracemark } from '@tracemark/browser';

tracemark.identify(user.id, { set: { email: user.email, plan: user.plan } });`
					}
				]
			}
		]
	},
	{
		id: 'node',
		label: 'Node.js',
		category: 'backend',
		tagline: 'Node, Bun, Deno, edge',
		icon: 'node',
		steps: [
			{
				title: 'Install the SDK',
				body: 'No dependencies, and it runs on Node 20+, Bun, Deno and edge runtimes.',
				packages: ['@tracemark/node']
			},
			{
				title: 'Create a client',
				body: 'Create one client per process and share it.',
				files: [{ name: 'tracemark.ts', language: 'ts', code: SERVER_CLIENT }]
			},
			{
				title: 'Capture an event',
				body: 'Events are batched in the background. Call shutdown() before the process exits so none are lost.',
				files: [
					{
						name: 'server.ts',
						language: 'ts',
						code: () => `import { tracemark } from './tracemark';

tracemark.capture({ distinctId: user.id, event: 'invoice_paid', properties: { amount: 49 } });

${nodeShutdown}`
					}
				]
			}
		]
	},
	{
		id: 'express',
		label: 'Express',
		category: 'backend',
		tagline: 'Middleware',
		icon: 'express',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Express middleware ships with the Node SDK.',
				packages: ['@tracemark/node']
			},
			{
				title: 'Add the middleware',
				body: 'Every request gets req.tracemark for its person, and errors your routes throw are captured. Add the error handler after your routes.',
				files: [
					{
						name: 'server.ts',
						language: 'ts',
						code: ({ key, host }) => `import express from 'express';
import { Tracemark } from '@tracemark/node';
import { tracemark as tracemarkMiddleware, tracemarkErrorHandler } from '@tracemark/node/express';

const tracemark = new Tracemark({ apiKey: '${key}', host: '${host}' });
const app = express();

app.use(tracemarkMiddleware(tracemark, { distinctId: (req) => req.user?.id }));

app.post('/checkout', (req, res) => {
  req.tracemark?.capture('checkout_started');
  res.sendStatus(204);
});

app.use(tracemarkErrorHandler(tracemark));`
					}
				]
			},
			{
				title: 'Flush on shutdown',
				body: 'Send queued events before the process exits.',
				files: [{ name: 'server.ts', language: 'ts', code: () => nodeShutdown }]
			}
		]
	},
	{
		id: 'hono',
		label: 'Hono',
		category: 'backend',
		tagline: 'Any runtime',
		icon: 'hono',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Hono middleware ships with the Node SDK and runs wherever Hono does.',
				packages: ['@tracemark/node']
			},
			{
				title: 'Add the middleware',
				body: 'getTracemark(c) returns the request’s person for events and flags. Errors your handlers throw are captured.',
				files: [
					{
						name: 'src/index.ts',
						language: 'ts',
						code: ({ key, host }) => `import { Hono } from 'hono';
import { Tracemark } from '@tracemark/node';
import { tracemark as tracemarkMiddleware, getTracemark } from '@tracemark/node/hono';

const tracemark = new Tracemark({ apiKey: '${key}', host: '${host}' });
const app = new Hono();

app.use(tracemarkMiddleware(tracemark, { distinctId: (c) => c.get('user')?.id }));

app.post('/checkout', (c) => {
  getTracemark(c).capture('checkout_started');
  return c.body(null, 204);
});

export default app;`
					}
				]
			}
		]
	},
	{
		id: 'fastify',
		label: 'Fastify',
		category: 'backend',
		tagline: 'Plugin',
		icon: 'fastify',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Fastify plugin ships with the Node SDK.',
				packages: ['@tracemark/node']
			},
			{
				title: 'Register the plugin',
				body: 'Every route gets request.tracemark, including routes in child plugins. Errors your handlers throw are captured.',
				files: [
					{
						name: 'server.ts',
						language: 'ts',
						code: ({ key, host }) => `import Fastify from 'fastify';
import { Tracemark } from '@tracemark/node';
import { tracemark as tracemarkPlugin } from '@tracemark/node/fastify';

const tracemark = new Tracemark({ apiKey: '${key}', host: '${host}' });
const app = Fastify();

await app.register(tracemarkPlugin(tracemark));

app.post('/checkout', async (request) => {
  request.tracemark.capture('checkout_started');
  return { ok: true };
});

app.addHook('onClose', () => tracemark.shutdown());`
					}
				]
			}
		]
	},
	{
		id: 'elysia',
		label: 'Elysia',
		category: 'backend',
		tagline: 'Bun',
		icon: 'elysia',
		steps: [
			{
				title: 'Install the SDK',
				body: 'The Elysia plugin ships with the Node SDK.',
				packages: ['@tracemark/node']
			},
			{
				title: 'Add the plugin',
				body: 'Handlers get the request’s person as tracemark in their context. Errors your handlers throw are captured.',
				files: [
					{
						name: 'src/index.ts',
						language: 'ts',
						code: ({ key, host }) => `import { Elysia } from 'elysia';
import { Tracemark } from '@tracemark/node';
import { tracemark as tracemarkPlugin } from '@tracemark/node/elysia';

const tracemark = new Tracemark({ apiKey: '${key}', host: '${host}' });

new Elysia()
  .use(tracemarkPlugin(tracemark))
  .post('/checkout', ({ tracemark }) => {
    tracemark.capture('checkout_started');
    return { ok: true };
  })
  .listen(3000);`
					}
				]
			}
		]
	},
	{
		id: 'python',
		label: 'Python',
		category: 'backend',
		tagline: 'Django, Flask, FastAPI',
		icon: 'python',
		steps: [
			{
				title: 'Install the SDK',
				body: 'Runs on Python 3.9+ and uses only the standard library.',
				command: 'pip install tracemark-sdk'
			},
			{
				title: 'Create a client',
				body: 'Create one client per process, in a module your app imports at startup.',
				files: [
					{
						name: 'analytics.py',
						language: 'python',
						code: ({ key, host }) => `from tracemark import Tracemark

tracemark = Tracemark("${key}", host="${host}")`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'Events are sent in batches in the background, and the rest are flushed when the process exits.',
				files: [
					{
						name: 'views.py',
						language: 'python',
						code: () => `from analytics import tracemark

tracemark.capture(user.id, "invoice_paid", {"amount": 49})`
					}
				]
			}
		]
	},
	{
		id: 'go',
		label: 'Go',
		category: 'backend',
		tagline: 'Go 1.22+',
		icon: 'go',
		steps: [
			{
				title: 'Install the SDK',
				body: 'No dependencies outside the standard library.',
				command: 'go get github.com/TorstenDittmann/footprint/packages/sdk-go'
			},
			{
				title: 'Create a client',
				body: 'Create one client at startup and close it before your program exits so queued events are sent.',
				files: [
					{
						name: 'main.go',
						language: 'go',
						code: ({
							key,
							host
						}) => `import tracemark "github.com/TorstenDittmann/footprint/packages/sdk-go"

client, err := tracemark.New(tracemark.Config{
	APIKey: "${key}",
	Host:   "${host}",
})
if err != nil {
	log.Fatal(err)
}
defer client.Close(context.Background())`
					}
				]
			},
			{
				title: 'Capture an event',
				body: 'Capture from any handler; the client is safe to share between goroutines.',
				files: [
					{
						name: 'handlers.go',
						language: 'go',
						code: () => `client.Capture(tracemark.Event{
	DistinctID: user.ID,
	Event:      "invoice_paid",
	Properties: tracemark.Properties{"amount": 49},
})`
					}
				]
			}
		]
	},
	{
		id: 'curl',
		label: 'HTTP API',
		category: 'other',
		tagline: 'Any language',
		icon: 'curl',
		steps: [
			{
				title: 'Send a test event',
				body: 'POST a batch of events to /e from any language. Run this in a terminal to check the connection.',
				files: [
					{
						name: 'Terminal',
						language: 'sh',
						code: ({ key, host }) => `curl -X POST ${host}/e \\
  -H 'content-type: application/json' \\
  -d '{"api_key":"${key}","batch":[{"uuid":"'$(uuidgen)'","event":"hello_tracemark","distinct_id":"test-user","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}]}'`
					}
				]
			}
		]
	}
];
