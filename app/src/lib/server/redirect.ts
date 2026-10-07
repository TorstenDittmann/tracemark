/** Only same-origin paths are allowed as post-sign-in destinations. */
export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
	if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return fallback;
	}
	return value;
}
