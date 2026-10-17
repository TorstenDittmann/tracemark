<script lang="ts">
import { cn } from '#lib/utils.js';

let { class: className, tone = 'success' }: { class?: string; tone?: 'success' | 'primary' } =
	$props();
</script>

<span class={cn('relative inline-flex size-2', className)} aria-hidden="true">
	<span
		class={[
			'absolute inset-0 rounded-full animate-ping-soft',
			tone === 'success' ? 'bg-success' : 'bg-primary'
		]}
	></span>
	<span
		class={['relative size-2 rounded-full', tone === 'success' ? 'bg-success' : 'bg-primary']}
	></span>
</span>
