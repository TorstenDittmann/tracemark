<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import Copy from '@lucide/svelte/icons/copy';
import { toast } from 'svelte-sonner';
import { Button, type ButtonSize, type ButtonVariant } from '#lib/components/ui/button/index.js';
import { cn } from '#lib/utils.js';

let {
	text,
	label = 'Copy',
	toastMessage = 'Copied to clipboard',
	variant = 'ghost',
	size = 'icon-sm',
	showLabel = false,
	class: className
}: {
	text: string;
	label?: string;
	toastMessage?: string;
	variant?: ButtonVariant;
	size?: ButtonSize;
	showLabel?: boolean;
	class?: string;
} = $props();

let copied = $state(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		toast.error('Could not copy. Select the text and copy it yourself.');
		return;
	}
	copied = true;
	toast.success(toastMessage);
	clearTimeout(timer);
	timer = setTimeout(() => (copied = false), 1600);
}
</script>

<Button {variant} {size} class={cn('relative', className)} onclick={copy} aria-label={label}>
	<span class="relative inline-flex size-4 items-center justify-center">
		<Copy
			class={[
				'absolute size-4 transition-all duration-200',
				copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
			]}
		/>
		<Check
			class={[
				'absolute size-4 text-success transition-all duration-200',
				copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
			]}
		/>
	</span>
	{#if showLabel}
		{copied ? 'Copied' : label}
	{/if}
</Button>
