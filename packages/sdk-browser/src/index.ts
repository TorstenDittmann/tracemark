import { createClient } from './client';

export type { Config, PersonProperties, Plugin, TracemarkClient, WireEvent } from './client';
export type { Properties } from './properties';
export type { Persistence } from './storage';
export { uuidv7 } from './uuid';
export { VERSION } from './version';
export { createClient };

/**
 * Default client. Creating it touches no browser globals, so importing on the
 * server is safe; every method is a no-op until `init()` runs in a browser.
 */
export const tracemark = createClient();
export default tracemark;
