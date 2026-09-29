import type { IncomingMessage, ServerResponse } from 'node:http';
import { healthPayload } from '../serverRoutines.js';
import { methodNotAllowed, sendJson } from './_lib.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  sendJson(res, 200, healthPayload());
}
