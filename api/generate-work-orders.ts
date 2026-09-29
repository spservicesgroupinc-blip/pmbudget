import type { IncomingMessage, ServerResponse } from 'node:http';
import { runGenerateWorkOrders } from '../serverRoutines.js';
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

  const result = await runGenerateWorkOrders(parsed.value);
  sendJson(res, result.status, result.body);
}
