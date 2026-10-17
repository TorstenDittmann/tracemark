// Script-tag build: `window.tracemark` is the default client, with `createClient` attached.
import { createClient, type TracemarkClient } from './client';
import { tracemark } from './index';

const global = tracemark as TracemarkClient & { createClient: typeof createClient };
global.createClient = createClient;
export default global;
