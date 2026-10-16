<script lang="ts">
import type { ExperimentStatus } from '#lib/experiments.js';

let { status }: { status: ExperimentStatus } = $props();

const labels: Record<ExperimentStatus, string> = {
	draft: 'Draft',
	running: 'Running',
	complete: 'Complete'
};
</script>

<span
	class={['inline-flex items-center gap-1.5', status === 'running' ? '' : 'text-muted-foreground']}
>
	<span
		class={[
			'size-2 rounded-full',
			status === 'running'
				? 'bg-primary'
				: status === 'complete'
					? 'bg-foreground/60'
					: 'bg-muted-foreground/40'
		]}
		aria-hidden="true"
	></span>
	{labels[status]}
</span>
