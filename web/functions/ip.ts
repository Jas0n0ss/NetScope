/// <reference path="./types.d.ts" />
/** Cloudflare Pages Function: plain-text `GET /ip`. */

import { handlePlainIp } from './api/_lib/router';

export const onRequest: PagesFunction = async (context) => handlePlainIp(context);
