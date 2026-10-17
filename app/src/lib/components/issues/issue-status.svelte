<script lang="ts">
import StatusPill from '#lib/components/status-pill.svelte';
import { type IssueStatus, STATUSES } from '#lib/issues.js';

let { status, regressed = false }: { status: IssueStatus; regressed?: boolean } = $props();
</script>

<StatusPill
	tone={status === 'open'
		? regressed
			? 'warning'
			: 'destructive'
		: status === 'resolved'
			? 'success'
			: 'muted'}
>
	{regressed ? 'Regressed' : STATUSES[status]}
</StatusPill>
