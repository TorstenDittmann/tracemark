<script lang="ts">
import { cn } from '#lib/utils.js';

let { class: className }: { class?: string } = $props();
</script>

<span
	aria-hidden="true"
	class={cn(
		'flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7c7cf2] to-[#4f46e5] text-white shadow-sm shadow-primary/30',
		className
	)}
>
	<svg aria-hidden="true" viewBox="0 0 32 32" class="size-[80%]" fill="none" stroke="currentColor">
		<path
			d="M6 21l5.5-6 4.5 4 5-8"
			stroke-width="2.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<circle cx="24.5" cy="9" r="2.6" fill="currentColor" stroke="none" />
	</svg>
</span>
