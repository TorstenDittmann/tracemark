<script lang="ts">
import { type IssueStatus, STATUSES } from '#lib/issues.js';

let { status, regressed = false }: { status: IssueStatus; regressed?: boolean } = $props();
</script>

<span
	class={['inline-flex items-center gap-1.5', status === 'open' ? '' : 'text-muted-foreground']}
>
	<span
		class={[
			'size-2 rounded-full',
			status === 'open'
				? 'bg-destructive'
				: status === 'resolved'
					? 'bg-foreground/60'
					: 'bg-muted-foreground/40'
		]}
		aria-hidden="true"
	></span>
	{regressed ? 'Regressed' : STATUSES[status]}
</span>
