import { DATABASE_URL, SOURCEMAPS_DIR } from '$app/env/private';
import { defaultSourcemapsDir } from './sourcemaps';

/** Where this instance keeps uploaded source maps. */
export const sourcemapsDir = () => SOURCEMAPS_DIR || defaultSourcemapsDir(DATABASE_URL);
