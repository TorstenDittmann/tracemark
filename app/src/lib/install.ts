// Install snippets for the onboarding guide, one per platform. Keep package names in step with
// the SDK packages and docs/.

export interface Platform {
	id: string;
	label: string;
	/** A shell command that adds the SDK, when the platform has one. */
	install?: string;
	language: string;
	code: (key: string, host: string) => string;
	/** Where the snippet goes, shown above it. */
	hint: string;
}

export const PLATFORMS: Platform[] = [
	{
		id: 'html',
		label: 'HTML',
		language: 'html',
		hint: 'Paste before the closing </head> tag. Page views are captured automatically.',
		code: (
			key,
			host
		) => `<script src="https://unpkg.com/@footprint/browser/dist/footprint.iife.js"></script>
<script>
  footprint.init({ apiKey: '${key}', host: '${host}' });
</script>`
	},
	{
		id: 'js',
		label: 'JavaScript',
		install: 'npm install @footprint/browser',
		language: 'ts',
		hint: 'Initialize once on page load. Page views are captured automatically.',
		code: (key, host) => `import { footprint } from '@footprint/browser';

footprint.init({
  apiKey: '${key}',
  host: '${host}',
  // cookieless: true, // store nothing on visitors' devices
});`
	},
	{
		id: 'react',
		label: 'React',
		install: 'npm install @footprint/browser @footprint/react',
		language: 'tsx',
		hint: 'Wrap your app once. Hooks like useFeatureFlag work anywhere inside.',
		code: (key, host) => `import { footprint } from '@footprint/browser';
import { FootprintProvider } from '@footprint/react';

export function App() {
  return (
    <FootprintProvider
      client={footprint}
      options={{ apiKey: '${key}', host: '${host}' }}
    >
      <Routes />
    </FootprintProvider>
  );
}`
	},
	{
		id: 'vue',
		label: 'Vue',
		install: 'npm install @footprint/browser @footprint/vue',
		language: 'ts',
		hint: 'Install the plugin in main.ts.',
		code: (key, host) => `import { createFootprint } from '@footprint/vue';

app.use(
  createFootprint({
    options: { apiKey: '${key}', host: '${host}' }
  })
);`
	},
	{
		id: 'node',
		label: 'Node.js',
		install: 'npm install @footprint/node',
		language: 'ts',
		hint: 'Create one client per process and call shutdown() before it exits.',
		code: (key, host) => `import { Footprint } from '@footprint/node';

const footprint = new Footprint({ apiKey: '${key}', host: '${host}' });

footprint.capture({ distinctId: 'user_123', event: 'signed_up' });`
	},
	{
		id: 'python',
		label: 'Python',
		install: 'pip install footprint-sdk',
		language: 'python',
		hint: 'Events are sent in batches in the background.',
		code: (key, host) => `from footprint import Footprint

footprint = Footprint("${key}", host="${host}")

footprint.capture("user_123", "signed_up")`
	},
	{
		id: 'go',
		label: 'Go',
		install: 'go get github.com/TorstenDittmann/footprint/packages/sdk-go',
		language: 'go',
		hint: 'Close the client before your program exits so queued events are sent.',
		code: (key, host) => `client, err := footprint.New(footprint.Config{
	APIKey: "${key}",
	Host:   "${host}",
})
if err != nil {
	log.Fatal(err)
}
defer client.Close(context.Background())

client.Capture(footprint.Event{DistinctID: "user_123", Event: "signed_up"})`
	},
	{
		id: 'curl',
		label: 'cURL',
		language: 'sh',
		hint: 'Send one test event from your terminal to check the connection.',
		code: (key, host) => `curl -X POST ${host}/e \\
  -H 'content-type: application/json' \\
  -d '{"api_key":"${key}","batch":[{"uuid":"'$(uuidgen)'","event":"hello_tracemark","distinct_id":"test-user","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}]}'`
	}
];
