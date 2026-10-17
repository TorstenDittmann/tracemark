# @tracemark/cli

Command-line tools for [tracemark](https://github.com/TorstenDittmann/tracemark), self-hosted product analytics. Requires Node.js 20+.

Upload source maps so error tracking can show original source locations:

```sh
export TRACEMARK_HOST=https://analytics.example.com
export TRACEMARK_SECRET_KEY=fp_sec_…
npx @tracemark/cli sourcemaps upload ./dist --release 1.0.0 --url-prefix ~/assets/
```

Use the same `release` in the SDK. Add `--dry-run` to preview the upload, or run `npx @tracemark/cli --help` for all options.

[Error tracking documentation](https://github.com/TorstenDittmann/tracemark/blob/main/docs/errors.md)

MIT licensed.
