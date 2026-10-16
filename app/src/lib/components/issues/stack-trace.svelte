<script lang="ts">
import {
	type ExceptionEntry,
	frameLocation,
	originalLocation,
	type StackFrame
} from '#lib/issues.js';

let { exceptions }: { exceptions: ExceptionEntry[] } = $props();

let showAll = $state(false);

/** The frame whose source opens by default: the first app frame of the error itself. */
const opened = $derived(
	exceptions[0]?.frames.findIndex((frame) => frame.inApp && frame.original?.context) ?? -1
);

const hidden = $derived(
	exceptions.reduce((sum, entry) => sum + entry.frames.filter((frame) => !frame.inApp).length, 0)
);
</script>

{#snippet label(
	frame: StackFrame
)}
	<span class={frame.inApp ? 'font-semibold' : ''}>
		{frame.function || frame.original?.name || '<anonymous>'}
	</span>
	{#if frame.original}
		<span class="text-muted-foreground" title="Minified: {frameLocation(frame)}">
			{originalLocation(frame.original)}
		</span>
	{:else}
		<span class="text-muted-foreground">{frameLocation(frame)}</span>
	{/if}
{/snippet}

<div class="grid gap-4">
	{#each exceptions as entry, i (i)}
		<section class="grid gap-2">
			<div>
				{#if i > 0}
					<p class="text-xs text-muted-foreground">Caused by</p>
				{/if}
				<p class="break-words">
					<span class="font-medium">{entry.type}</span
					><span class="text-muted-foreground">{entry.value ? `: ${entry.value}` : ''}</span>
				</p>
				{#if entry.mechanism || entry.handled !== undefined}
					<p class="text-xs text-muted-foreground">
						{entry.handled === false ? 'Unhandled' : entry.handled ? 'Handled' : ''}
						{entry.mechanism ? `via ${entry.mechanism}` : ''}
					</p>
				{/if}
			</div>
			{#if entry.frames.length}
				<ol class="overflow-x-auto rounded-md border font-mono text-xs">
					<!-- Innermost call first, like the stack the runtime printed. -->
					{#each entry.frames as frame, j (j)}
						{#if frame.inApp || showAll}
							<li class={['border-t first:border-t-0', frame.inApp ? '' : 'text-muted-foreground']}>
								{#if frame.original?.context}
									{@const context = frame.original.context}
									<details open={i === 0 && j === opened}>
										<summary
											class="flex cursor-pointer gap-2 px-3 py-1.5 whitespace-nowrap hover:bg-muted/50"
										>
											{@render label(frame)}
										</summary>
										<pre class="overflow-x-auto border-t bg-muted/40 py-1.5"><code
												>{#each context.lines as line, k (k)}{@const number = context.start + k}<span
														class={[
	'block px-3',
	number === frame.original.line
		? 'bg-destructive/10 font-semibold text-foreground'
		: 'text-muted-foreground'
]}
														><span class="inline-block w-10 pr-3 text-right select-none opacity-60">{number}</span
														>{line}</span
													>{/each}</code
											></pre>
									</details>
								{:else}
									<div class="flex gap-2 px-3 py-1.5 whitespace-nowrap">
										{@render label(frame)}
									</div>
								{/if}
							</li>
						{/if}
					{/each}
					{#if !showAll && entry.frames.every((frame) => !frame.inApp)}
						<li class="px-3 py-1.5 text-muted-foreground">
							{entry.frames.length}
							library {entry.frames.length === 1 ? 'frame' : 'frames'}
						</li>
					{/if}
				</ol>
			{:else}
				<p class="text-sm text-muted-foreground">No stack trace was sent.</p>
			{/if}
		</section>
	{/each}
	{#if hidden}
		<button
			type="button"
			class="justify-self-start text-sm text-muted-foreground underline hover:text-foreground"
			onclick={() => (showAll = !showAll)}
		>
			{showAll
				? 'Only show app frames'
				: `Show ${hidden} library ${hidden === 1 ? 'frame' : 'frames'}`}
		</button>
	{/if}
</div>
