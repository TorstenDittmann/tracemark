// Syntax highlighting for code blocks. Shiki loads on first use in the browser, with only the
// languages the install guide needs, so pages render plain code first and colour it after.
import type { HighlighterCore, ThemedToken } from 'shiki/core';

const LANGUAGES: Record<string, string> = {
	ts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	html: 'html',
	vue: 'vue',
	svelte: 'svelte',
	python: 'python',
	go: 'go',
	sh: 'shellscript',
	dotenv: 'dotenv'
};

let highlighter: Promise<HighlighterCore> | undefined;

function load(): Promise<HighlighterCore> {
	highlighter ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
			import('shiki/core'),
			import('shiki/engine/javascript')
		]);
		return createHighlighterCore({
			themes: [
				import('@shikijs/themes/github-light-default'),
				import('@shikijs/themes/github-dark-default')
			],
			langs: [
				import('@shikijs/langs/typescript'),
				import('@shikijs/langs/tsx'),
				import('@shikijs/langs/javascript'),
				import('@shikijs/langs/html'),
				import('@shikijs/langs/vue'),
				import('@shikijs/langs/svelte'),
				import('@shikijs/langs/python'),
				import('@shikijs/langs/go'),
				import('@shikijs/langs/shellscript'),
				import('@shikijs/langs/dotenv')
			],
			engine: createJavaScriptRegexEngine()
		});
	})();
	return highlighter;
}

export interface Token {
	content: string;
	/** Inline style with `--shiki-light` and `--shiki-dark` colours; layout.css picks one. */
	style: string;
}

function style(token: ThemedToken): string {
	return Object.entries(token.htmlStyle ?? {})
		.map(([key, value]) => `${key}:${value}`)
		.join(';');
}

/** Lines of coloured tokens, or undefined for languages the guide doesn't load. */
export async function highlight(code: string, language: string): Promise<Token[][] | undefined> {
	const lang = LANGUAGES[language];
	if (!lang) return undefined;
	const shiki = await load();
	const { tokens } = shiki.codeToTokens(code, {
		lang,
		themes: { light: 'github-light-default', dark: 'github-dark-default' },
		defaultColor: false
	});
	return tokens.map((line) => line.map((t) => ({ content: t.content, style: style(t) })));
}
