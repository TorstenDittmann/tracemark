<script lang="ts">
import { type ExceptionEntry, frameLocation } from '#lib/issues.js';

let { exceptions }: { exceptions: ExceptionEntry[] } = $props();

let showAll = $state(false);

const hidden = $derived(
	exceptions.reduce((sum, entry) => sum + entry.frames.filter((frame) => !frame.inApp).length, 0)
);
</script>

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
							<li
								class={[
									'flex gap-2 border-t px-3 py-1.5 whitespace-nowrap first:border-t-0',
									frame.inApp ? '' : 'text-muted-foreground'
								]}
							>
								<span class={frame.inApp ? 'font-semibold' : ''}>
									{frame.function || '<anonymous>'}
								</span>
								<span class="text-muted-foreground">{frameLocation(frame)}</span>
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
