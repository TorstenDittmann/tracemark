<script lang="ts">
import Bot from '@lucide/svelte/icons/bot';
import Check from '@lucide/svelte/icons/check';
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import FileCode from '@lucide/svelte/icons/file-code';
import Search from '@lucide/svelte/icons/search';
import SquareTerminal from '@lucide/svelte/icons/square-terminal';
import { onMount } from 'svelte';
import CodeBlock from '#lib/components/code-block.svelte';
import CopyButton from '#lib/components/copy-button.svelte';
import LiveDot from '#lib/components/live-dot.svelte';
import { Button } from '#lib/components/ui/button/index.js';
import {
	agentPrompt,
	CATEGORIES,
	FRAMEWORKS,
	installCommand,
	PACKAGE_MANAGERS,
	type PackageManager
} from '#lib/install.js';
import BrandLogo from './brand-logo.svelte';

let { publicKey, host, live }: { publicKey: string; host: string; live: boolean } = $props();

const FRAMEWORK_KEY = 'tracemark:install-framework';
const MANAGER_KEY = 'tracemark:package-manager';

let frameworkId = $state<string>();
let picking = $state(true);
let query = $state('');
let manager = $state<PackageManager>('npm');

const framework = $derived(FRAMEWORKS.find((f) => f.id === frameworkId));
const ctx = $derived({ key: publicKey, host });
const prompt = $derived(agentPrompt(framework, ctx));
let showPrompt = $state(false);

const matches = $derived.by(() => {
	const q = query.trim().toLowerCase();
	const list = q
		? FRAMEWORKS.filter((f) => `${f.label} ${f.tagline}`.toLowerCase().includes(q))
		: FRAMEWORKS;
	return CATEGORIES.map((c) => ({
		...c,
		items: list.filter((f) => f.category === c.id)
	})).filter((c) => c.items.length > 0);
});

// Remember the reader's choices on this device. Storage can be unavailable, which is fine.
onMount(() => {
	try {
		const saved = localStorage.getItem(FRAMEWORK_KEY);
		if (saved && FRAMEWORKS.some((f) => f.id === saved)) {
			frameworkId = saved;
			picking = false;
		}
		const pm = localStorage.getItem(MANAGER_KEY);
		if (pm && (PACKAGE_MANAGERS as readonly string[]).includes(pm)) {
			manager = pm as PackageManager;
		}
	} catch {}
});

function choose(id: string) {
	frameworkId = id;
	picking = false;
	query = '';
	try {
		localStorage.setItem(FRAMEWORK_KEY, id);
	} catch {}
}

function setManager(value: PackageManager) {
	manager = value;
	try {
		localStorage.setItem(MANAGER_KEY, value);
	} catch {}
}
</script>

{#snippet marker(
	state: 'done' | 'current' | 'todo' | 'optional',
	n: number
)}
	<span
		class={[
			'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-200',
			state === 'done' && 'border-primary bg-primary text-primary-foreground',
			state === 'current' && 'border-primary bg-background text-primary ring-4 ring-primary/10',
			state === 'todo' && 'bg-background text-foreground',
			state === 'optional' && 'border-dashed bg-background text-muted-foreground'
		]}
	>
		{#if state === 'done'}
			<Check class="size-3.5" />
		{:else}
			{n}
		{/if}
	</span>
{/snippet}

{#snippet managerSwitch()}
	<fieldset class="flex items-center rounded-md bg-background/60 p-0.5">
		<legend class="sr-only">Package manager</legend>
		{#each PACKAGE_MANAGERS as pm (pm)}
			<button
				type="button"
				aria-pressed={manager === pm}
				onclick={() => setManager(pm)}
				class={[
					'rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors',
					manager === pm
						? 'bg-foreground/10 text-foreground'
						: 'text-muted-foreground hover:text-foreground'
				]}
			>
				{pm}
			</button>
		{/each}
	</fieldset>
{/snippet}

<!-- Hand the whole setup to a coding agent with one copied prompt. -->
<div
	class="mb-8 grid gap-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/[0.03] to-transparent p-4"
>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-3">
		<span
			class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30"
		>
			<Bot class="size-5" />
		</span>
		<div class="grid min-w-48 flex-1 gap-0.5">
			<p class="font-medium">Let your coding agent set it up</p>
			<p class="text-sm text-muted-foreground">
				Paste one prompt into Claude Code, Cursor, Codex or any other agent.
				{framework
					? `It has the ${framework.label} steps and your key.`
					: 'It works out your framework and has your key.'}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button
				variant="ghost"
				size="sm"
				aria-expanded={showPrompt}
				onclick={() => (showPrompt = !showPrompt)}
			>
				{showPrompt ? 'Hide' : 'Preview'}
				<ChevronDown class={['transition-transform duration-200', showPrompt && 'rotate-180']} />
			</Button>
			<CopyButton
				text={prompt}
				label="Copy prompt"
				toastMessage="Prompt copied. Paste it into your coding agent."
				showLabel
				size="sm"
				variant="default"
			/>
		</div>
	</div>
	{#if showPrompt}
		<pre
			class="max-h-80 overflow-auto rounded-lg border bg-background/80 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
		>{prompt}</pre>
	{/if}
</div>

<ol class="grid">
	<!-- Step 1: pick a framework. -->
	<li class="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4 pb-8">
		<span
			class="absolute top-8 bottom-1 left-3.5 w-px -translate-x-1/2 bg-border"
			aria-hidden="true"
		></span>
		{@render marker(framework && !picking ? 'done' : 'current', 1)}
		<div class="grid min-w-0 gap-3">
			<div class="flex min-h-7 flex-wrap items-center justify-between gap-2">
				<h3 class="font-medium">Choose your framework</h3>
				{#if framework && !picking}
					<Button variant="ghost" size="sm" onclick={() => (picking = true)}>Change</Button>
				{:else if framework}
					<Button variant="ghost" size="sm" onclick={() => (picking = false)}>Cancel</Button>
				{/if}
			</div>

			{#if framework && !picking}
				<button
					type="button"
					onclick={() => (picking = true)}
					class="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-foreground/20"
				>
					<span class="flex size-10 items-center justify-center rounded-lg border bg-background">
						<BrandLogo icon={framework.icon} label={framework.label} />
					</span>
					<span class="grid leading-tight">
						<span class="font-medium">{framework.label}</span>
						<span class="text-sm text-muted-foreground">{framework.tagline}</span>
					</span>
				</button>
			{:else}
				<label class="relative block">
					<span class="sr-only">Search frameworks</span>
					<Search
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						bind:value={query}
						placeholder="Search frameworks"
						class="h-9 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
					>
				</label>
				<div class="grid gap-4">
					{#each matches as group (group.id)}
						<div class="grid gap-2">
							<p class="text-xs font-medium text-muted-foreground">{group.label}</p>
							<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
								{#each group.items as f (f.id)}
									<button
										type="button"
										onclick={() => choose(f.id)}
										aria-pressed={f.id === frameworkId}
										class={[
											'group flex flex-col items-start gap-2 rounded-xl border bg-card p-2.5 text-left sm:flex-row sm:items-center sm:gap-3 transition-all duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm active:translate-y-0',
											f.id === frameworkId && 'border-primary ring-2 ring-primary/15'
										]}
									>
										<span
											class="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background transition-transform duration-150 group-hover:scale-105"
										>
											<BrandLogo icon={f.icon} label={f.label} />
										</span>
										<span class="grid min-w-0 leading-tight">
											<span class="text-sm font-medium sm:truncate">{f.label}</span>
											<span class="text-xs text-muted-foreground sm:truncate">{f.tagline}</span>
										</span>
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">
							Nothing matches “{query}”. The JavaScript SDK works in any browser app, and the HTTP
							API works from any language.
						</p>
					{/each}
				</div>
			{/if}
		</div>
	</li>

	{#if framework && !picking}
		{#each framework.steps as step, i (`${framework.id}-${i}`)}
			<li class="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4 pb-8">
				<span
					class="absolute top-8 bottom-1 left-3.5 w-px -translate-x-1/2 bg-border"
					aria-hidden="true"
				></span>
				{@render marker(step.optional ? 'optional' : 'todo', i + 2)}
				<div class="grid min-w-0 gap-3">
					<div class="grid gap-1">
						<h3 class="flex min-h-7 flex-wrap items-center gap-2 font-medium">
							{step.title}
							{#if step.optional}
								<span
									class="rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
									>Optional</span
								>
							{/if}
						</h3>
						<p class="text-sm text-muted-foreground">{step.body}</p>
					</div>
					{#if step.packages}
						<CodeBlock
							code={installCommand(manager, step.packages)}
							label="Terminal"
							icon={SquareTerminal}
							language="sh"
							actions={managerSwitch}
						/>
					{/if}
					{#if step.command}
						<CodeBlock code={step.command} language="sh" label="Terminal" icon={SquareTerminal} />
					{/if}
					{#each step.files ?? [] as file (file.name)}
						<CodeBlock
							code={file.code(ctx)}
							language={file.language}
							label={file.name}
							icon={FileCode}
						/>
					{/each}
				</div>
			</li>
		{/each}

		<!-- Last step: the page listens for the first event. -->
		<li class="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4">
			{@render marker(live ? 'done' : 'todo', framework.steps.length + 2)}
			<div class="grid min-w-0 gap-3">
				<div class="grid gap-1">
					<h3 class="flex min-h-7 items-center font-medium">Check that it works</h3>
					<p class="text-sm text-muted-foreground">
						{#if framework.category === 'backend' || framework.category === 'other'}
							Run your server and trigger the code above.
						{:else}
							Open your app in a browser.
						{/if}
						This page updates by itself the moment the first event arrives.
					</p>
				</div>
				<div
					class={[
						'flex items-center gap-3 rounded-xl border p-3 text-sm transition-colors',
						live ? 'border-success/30 bg-success/10' : 'border-dashed bg-muted/30'
					]}
				>
					{#if live}
						<span
							class="flex size-6 items-center justify-center rounded-full bg-success text-white"
						>
							<Check class="size-3.5" />
						</span>
						<span class="font-medium">Your first event arrived</span>
					{:else}
						<span class="flex size-6 items-center justify-center">
							<LiveDot tone="primary" />
						</span>
						<span class="text-muted-foreground">Waiting for the first event…</span>
					{/if}
				</div>
			</div>
		</li>
	{/if}
</ol>
