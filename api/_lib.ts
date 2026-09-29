import type { IncomingMessage, ServerResponse } from 'node:http';

export type ReadJsonBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number; body: { error: string } };

/**
 * Read a request stream into a JSON object. Mirrors the dev server's JSON
 * parsing semantics: an empty body yields `{}` and JSON primitives/null are
 * rejected. Bodies over `limitBytes` are rejected with 413 (Vercel caps
 * request bodies at ~4.5 MB) instead of being buffered into memory.
 */
export async function readJsonBody(
  req: IncomingMessage,
  limitBytes = 4_500_000
): Promise<ReadJsonBodyResult> {
  const chunks: Buffer[] = [];
  let received = 0;
  let overflowed = false;

  try {
    for await (const chunk of req) {
      const buffer: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      received += buffer.length;
      if (received > limitBytes) {
        // Keep draining the stream (without buffering) so the connection stays healthy.
        overflowed = true;
        continue;
      }
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, status: 400, body: { error: 'Invalid JSON request body.' } };
  }

  if (overflowed) {
    return {
      ok: false,
      status: 413,
      body: {
        error:
          'Request body too large for serverless deployment (limit ~4.5 MB). Use the Paste Text option for large estimates.',
      },
    };
  }

  if (received === 0) {
    // A bodyless request is not bad JSON: the dev server parses it as {}.
    return { ok: true, value: {} };
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { ok: false, status: 400, body: { error: 'Invalid JSON request body.' } };
  }

  if (value === null || typeof value !== 'object') {
    return { ok: false, status: 400, body: { error: 'Invalid JSON request body.' } };
  }

  return { ok: true, value: value as Record<string, unknown> };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method not allowed.' });
}
