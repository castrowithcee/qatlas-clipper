import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PAGES_DIR = fileURLToPath(new URL('./pages/', import.meta.url));
// Fixed allow-list: request paths never reach the file system.
const PAGE_FILES = new Set(['jsonld.html', 'meta.html', 'plain-1.html', 'plain-2.html']);

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Port 0: the OS picks a free port. Loopback only.
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

export interface TestPages {
  /** Base URL without trailing slash, e.g. http://127.0.0.1:41234 */
  origin: string;
  close(): Promise<void>;
}

/** Serves the local test pages from e2e/pages on 127.0.0.1. */
export async function startPages(): Promise<TestPages> {
  const server = createServer((req, res) => {
    const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
    if (req.method !== 'GET' || !PAGE_FILES.has(name)) {
      res.writeHead(404).end();
      return;
    }
    readFile(PAGES_DIR + name).then(
      (body) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body),
      () => res.writeHead(500).end(),
    );
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, close: () => close(server) };
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** Parsed JSON body; undefined if the body was empty or not JSON. */
  body: unknown;
  rawBody: string;
}

export interface TestWebhook {
  /** http://localhost:<port>/hook answers 200 JSON. */
  url: string;
  /** http://localhost:<port>/hook-error answers 500 with a text body. */
  errorUrl: string;
  requests: RecordedRequest[];
  clear(): void;
  close(): Promise<void>;
}

export const WEBHOOK_RESPONSE = { message: 'Received by test webhook', url: 'https://example.com/item/1' };
export const WEBHOOK_ERROR_TEXT = 'Test webhook failure';

/** Records every request and answers on /hook (200 JSON) and /hook-error (500 text). */
export async function startWebhook(): Promise<TestWebhook> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = rawBody ? JSON.parse(rawBody) : undefined;
      } catch {
        body = undefined;
      }
      requests.push({ method: req.method ?? '', path, headers: req.headers, body, rawBody });
      if (path === '/hook') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(WEBHOOK_RESPONSE));
      } else if (path === '/hook-error') {
        res.writeHead(500, { 'content-type': 'text/plain' }).end(WEBHOOK_ERROR_TEXT);
      } else {
        res.writeHead(404).end();
      }
    });
  });
  const port = await listen(server);
  return {
    // "localhost" (not the IP) because target URLs only allow http: for that host name.
    url: `http://localhost:${port}/hook`,
    errorUrl: `http://localhost:${port}/hook-error`,
    requests,
    clear: () => void (requests.length = 0),
    close: () => close(server),
  };
}
