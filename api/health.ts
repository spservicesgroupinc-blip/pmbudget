import type { IncomingMessage, ServerResponse } from 'node:http';
import { healthPayload } from '../serverRoutines';
import { methodNotAllowed, sendJson } from './_lib';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  sendJson(res, 200, healthPayload());
}
