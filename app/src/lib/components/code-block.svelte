<script lang="ts">
import type { Component, Snippet } from 'svelte';
import CopyButton from '#lib/components/copy-button.svelte';
import { highlight, type Token } from '#lib/highlight.js';
import { cn } from '#lib/utils.js';

let {
	code,
	language,
	label,
	icon: Icon,
	actions,
	class: className
}: {
	code: string;
	/** Colours the code when set, such as `ts` or `sh`. */
	language?: string;
	label?: string;
	/** Shown before the label, such as a file icon. */
	icon?: Component;
	/** Extra controls in the header, before the copy button. */
	actions?: Snippet;
	class?: string;
} = $props();

let lines = $state<Token[][]>();
$effect(() => {
	const current = code;
	lines = undefined;
	if (!language) return;
	let stale = false;
	highlight(current, language)
		.then((result) => {
			if (!stale) lines = result;
		})
		.catch(() => {});
	return () => {
		stale = true;
	};
});
</script>

<div class={cn('group/code overflow-hidden rounded-xl border bg-muted/40', className)}>
	{#if label}
		<div class="flex h-9 items-center justify-between gap-2 border-b bg-muted/40 pr-1 pl-3">
			<span class="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
				{#if Icon}
					<Icon class="size-3.5 shrink-0" />
				{/if}
				<span class="truncate">{label}</span>
			</span>
			<span class="flex items-center gap-1">
				{@render actions?.()}
				<CopyButton text={code} label="Copy code" />
			</span>
		</div>
	{/if}
	<div class="relative">
		<pre class="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed"><code
				>{#if lines}{#each lines as line, i (i)}{#each line as token, j (j)}<span
								class="shiki-token"
								style={token.style}>{token.content}</span
							>{/each}{#if i < lines.length - 1}{'\n'}{/if}{/each}{:else}{code}{/if}</code
			></pre>
		{#if !label}
			<CopyButton
				text={code}
				label="Copy code"
				class="absolute top-2 right-2 bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
			/>
		{/if}
	</div>
</div>
