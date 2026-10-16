// Container entrypoint: applies migrations, then starts the built server.
import { resolve } from 'node:path';

await import('./migrate');
// A computed path keeps the bundler from inlining the server build.
await import(resolve(import.meta.dir, '..', 'build', 'index.js'));
