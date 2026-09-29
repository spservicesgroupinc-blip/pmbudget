import type { IncomingMessage, ServerResponse } from 'node:http';
import { runProcessEstimate } from '../serverRoutines.js';
import { methodNotAllowed, readJsonBody, sendJson } from './_lib.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    sendJson(res, parsed.status, parsed.body);
    return;
  }

  const result = await runProcessEstimate(parsed.value);
  sendJson(res, result.status, result.body);
}
