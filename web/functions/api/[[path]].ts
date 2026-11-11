/// <reference path="../types.d.ts" />
/**
 * Cloudflare Pages Function: catch-all for `/api/*`.
 *
 * The router lives in `_lib/router.ts`; helper modules under `_lib/` are not
 * routed by Pages because directories starting with `_` are ignored.
 */

import { handleApi } from './_lib/router';

export const onRequest: PagesFunction = async (context) => handleApi(context);
