// Script-tag build: `window.footprint` is the default client, with `createClient` attached.
import { createClient, type FootprintClient } from './client';
import { footprint } from './index';

const global = footprint as FootprintClient & { createClient: typeof createClient };
global.createClient = createClient;
export default global;
