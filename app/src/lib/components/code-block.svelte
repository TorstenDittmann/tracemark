<script lang="ts">
import CopyButton from '#lib/components/copy-button.svelte';
import { cn } from '#lib/utils.js';

let { code, label, class: className }: { code: string; label?: string; class?: string } = $props();
</script>

<div class={cn('group/code overflow-hidden rounded-xl border bg-muted/40', className)}>
	{#if label}
		<div class="flex h-9 items-center justify-between border-b bg-muted/40 pr-1 pl-3">
			<span class="font-mono text-xs text-muted-foreground">{label}</span>
			<CopyButton text={code} label="Copy code" />
		</div>
	{/if}
	<div class="relative">
		<pre class="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed"><code>{code}</code></pre>
		{#if !label}
			<CopyButton
				text={code}
				label="Copy code"
				class="absolute top-2 right-2 bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
			/>
		{/if}
	</div>
</div>
