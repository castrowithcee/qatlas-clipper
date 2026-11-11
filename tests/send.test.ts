import { describe, expect, it, vi } from 'vitest';
import { CONFIG_KEY, HEADER_VALUES_KEY } from '../src/config';
import type { PermissionsApi } from '../src/options/permissions';
import { buildPayload } from '../src/send/payload';
import { evaluateResponse, MAX_ERROR_TEXT_CHARS, readLimitedText } from '../src/send/response';
import { MAX_RESULT_URLS, beginSend, finishSend, loadResults } from '../src/send/results';
import { sendToTarget, type SendRequest } from '../src/send/send';
import { createSendListener, requestSend, SEND_MESSAGE_TYPE } from '../src/send/messages';
import { fakeStorage } from './helpers/picker';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} }, runtime: {} } }));

const target = (id: string, url: string, headers: string[]) => ({ id, name: `Target ${id}`, url, headers, purpose: 'Test' });
const field = (key: string) => ({ key, label: key, required: false, sources: {} });
const project = (id: string, targets: unknown[]) => ({
  id, name: `Project ${id}`, scope: { allSites: true, domains: [] }, fields: [field('title'), field('price')], siteMappings: {}, targets,
});

const TAB = 'https://example.com/article';

function setup(opts: { granted?: boolean; fetchImpl?: typeof fetch } = {}) {
  const config = fakeStorage({
    [CONFIG_KEY]: {
      schemaVersion: 1,
      projects: [
        project('p1', [target('a', 'https://hooks.example.com/a', ['X-Token', 'X-Extra']), target('b', 'https://hooks.example.org/b', ['X-Token'])]),
        project('p2', [target('c', 'https://hooks.example.net/c', [])]),
      ],
    },
    [HEADER_VALUES_KEY]: { a: { 'X-Token': 'secret-a' }, b: { 'X-Token': 'secret-b' }, c: {} },
  });
  const results = fakeStorage();
  const fetchMock = vi.fn(opts.fetchImpl ?? (async () => new Response('', { status: 200 })));
  const contains = vi.fn(async () => opts.granted ?? true);
  const permissions: PermissionsApi = { contains, request: vi.fn(), remove: vi.fn() };
  const deps = { config, results, permissions, fetch: fetchMock as unknown as typeof fetch };
  return { config, results, fetchMock, contains, deps };
}

const payloadFor = (projectId: string, targetId: string) =>
  buildPayload({
    project: { id: projectId, name: `Project ${projectId}`, fields: [{ key: 'title' }, { key: 'price' }] },
    target: { id: targetId, name: `Target ${targetId}` },
    url: TAB, title: 'Article', values: { title: 'Article' }, content: '# Article', contentFormat: 'markdown', note: 'n',
    now: () => new Date('2026-01-02T03:04:05.000Z'),
  });
const req = (projectId: string, targetId: string, extra: Record<string, unknown> = {}): SendRequest =>
  ({ tabUrl: TAB, projectId, targetId, payload: payloadFor(projectId, targetId), ...extra });

describe('payload', () => {
  it('has exactly the eleven keys', () => {
    const p = buildPayload({
      project: { id: 'p1', name: 'Articles', fields: [{ key: 'title' }, { key: 'price' }] },
      target: { id: 'a', name: 'Hook' },
      url: TAB, title: 'Article', values: { title: 'T', stray: 'x' }, content: '# T', contentFormat: 'markdown', note: 'note',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });
    expect(Object.keys(p).sort()).toEqual(['captured_at', 'content', 'content_format', 'domain', 'fields', 'note', 'project', 'target', 'title', 'url', 'version']);
    expect(p).toEqual({
      project: { id: 'p1', name: 'Articles' }, target: { id: 'a', name: 'Hook' }, url: TAB, title: 'Article', domain: 'example.com',
      fields: { title: 'T', price: '' }, content: '# T', content_format: 'markdown', note: 'note', captured_at: '2026-01-02T03:04:05.000Z', version: 1,
    });
  });
});

describe('payload domain', () => {
  const base = { project: { id: 'p1', name: 'A', fields: [] }, target: { id: 'a', name: 'H' }, title: 'T', values: {}, note: '', content: '', contentFormat: 'markdown' as const };
  it('lowercases, drops a leading www and keeps subdomains', () => {
    expect(buildPayload({ ...base, url: 'https://www.Example.com/a' }).domain).toBe('example.com');
    expect(buildPayload({ ...base, url: 'https://jobs.example.com/a' }).domain).toBe('jobs.example.com');
    expect(buildPayload({ ...base, url: 'about:blank' }).domain).toBe('');
  });
});

describe('payload content format', () => {
  const base = { project: { id: 'p1', name: 'A', fields: [] }, target: { id: 'a', name: 'H' }, url: TAB, title: 'T', values: {}, note: '' };
  it('carries html as given and empties content for none', () => {
    expect(buildPayload({ ...base, content: '<p>x</p>', contentFormat: 'html' })).toMatchObject({ content: '<p>x</p>', content_format: 'html' });
    expect(buildPayload({ ...base, content: 'ignored', contentFormat: 'none' })).toMatchObject({ content: '', content_format: 'none' });
  });
});

describe('evaluateResponse', () => {
  it('2xx with JSON message and url', () => {
    expect(evaluateResponse(201, JSON.stringify({ message: 'Saved', url: 'https://example.com/x' }))).toEqual({
      kind: 'success', status: 201, message: 'Saved', url: 'https://example.com/x',
    });
  });
  it('2xx non-JSON and non-object JSON are plain success', () => {
    expect(evaluateResponse(200, 'ok')).toEqual({ kind: 'success', status: 200 });
    expect(evaluateResponse(204, '')).toEqual({ kind: 'success', status: 204 });
    expect(evaluateResponse(200, '["a"]')).toEqual({ kind: 'success', status: 200 });
  });
  it('drops non-http(s) urls and non-string message', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'not a url']) {
      expect(evaluateResponse(200, JSON.stringify({ message: 5, url }))).toEqual({ kind: 'success', status: 200 });
    }
  });
  it('non-2xx carries status and truncated text', () => {
    const o = evaluateResponse(500, 'x'.repeat(1000));
    expect(o).toEqual({ kind: 'http-error', status: 500, text: 'x'.repeat(MAX_ERROR_TEXT_CHARS) });
    expect(evaluateResponse(302, 'moved').kind).toBe('http-error');
  });
  it('reads at most the limit of the body', async () => {
    expect((await readLimitedText(new Response('a'.repeat(1000)), 100)).length).toBe(100);
  });
});

describe('sendToTarget', () => {
  it('sends to the own target with only its headers', async () => {
    const s = setup();
    const out = await sendToTarget(req('p1', 'a'), s.deps);
    expect(out).toEqual({ kind: 'success', status: 200 });
    expect(s.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = s.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/a');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Token': 'secret-a' });
    expect(JSON.parse(init.body as string)).toEqual(payloadFor('p1', 'a'));
    expect(s.contains).toHaveBeenCalledWith(['https://hooks.example.com/*']);

    await sendToTarget(req('p1', 'b'), s.deps);
    const [urlB, initB] = s.fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(urlB).toBe('https://hooks.example.org/b');
    expect(initB.headers).toEqual({ 'Content-Type': 'application/json', 'X-Token': 'secret-b' });
  });

  it('skips header names the target no longer declares and Content-Type overrides', async () => {
    const s = setup();
    s.config.data[HEADER_VALUES_KEY] = { a: { 'X-Token': 't', 'X-Old': 'old', 'content-type': 'text/plain' } };
    (s.config.data[CONFIG_KEY] as { projects: { targets: { headers: string[] }[] }[] }).projects[0]!.targets[0]!.headers.push('content-type');
    await sendToTarget(req('p1', 'a'), s.deps);
    const init = (s.fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Token': 't' });
  });

  it('sends nothing for a foreign project or unknown target', async () => {
    const s = setup();
    expect((await sendToTarget(req('p2', 'a'), s.deps)).kind).toBe('unknown-target');
    expect((await sendToTarget(req('p1', 'zzz'), s.deps)).kind).toBe('unknown-target');
    expect((await sendToTarget({ ...req('p1', 'a'), payload: payloadFor('p1', 'b') }, s.deps)).kind).toBe('invalid-request');
    expect((await sendToTarget({ ...req('p1', 'a'), payload: { ...payloadFor('p1', 'a'), extra: 1 } }, s.deps)).kind).toBe('invalid-request');
    expect(s.fetchMock).not.toHaveBeenCalled();
  });

  it('returns no-permission without fetching', async () => {
    const s = setup({ granted: false });
    expect((await sendToTarget(req('p1', 'a'), s.deps)).kind).toBe('no-permission');
    expect(s.fetchMock).not.toHaveBeenCalled();
  });

  it('maps network error and timeout to fixed messages', async () => {
    const net = setup({ fetchImpl: async () => { throw new TypeError('boom secret-a'); } });
    const o = await sendToTarget(req('p1', 'a'), net.deps);
    expect(o.kind).toBe('network-error');
    expect(JSON.stringify(o)).not.toContain('secret');

    const slow = setup({
      fetchImpl: (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
    });
    expect((await sendToTarget(req('p1', 'a'), { ...slow.deps, timeoutMs: 10 })).kind).toBe('timeout');
  });

  it('stores the outcome per URL and target and clears the in-flight marker', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({ fetchImpl: async () => { await gate; return new Response('bad', { status: 400 }); } });
    const first = sendToTarget(req('p1', 'a'), s.deps);
    await vi.waitFor(async () => expect((await loadResults(s.results, TAB)).inFlight).toEqual(['a']));
    expect((await sendToTarget(req('p1', 'a'), s.deps)).kind).toBe('in-flight');
    expect(s.fetchMock).toHaveBeenCalledTimes(1);
    release();
    expect((await first).kind).toBe('http-error');
    const state = await loadResults(s.results, TAB);
    expect(state.inFlight).toEqual([]);
    expect(state.results.a!.outcome).toEqual({ kind: 'http-error', status: 400, text: 'bad' });
    expect(await loadResults(s.results, 'https://example.com/other')).toEqual({ results: {}, inFlight: [] });
    expect(JSON.stringify(s.results.data)).not.toContain('secret');
  });
});

describe('results storage', () => {
  it('keeps the last outcome per target, bounded by URL count', async () => {
    const st = fakeStorage();
    await finishSend(st, 'https://example.com/0', 'a', { kind: 'success', status: 200 });
    await finishSend(st, 'https://example.com/0', 'b', { kind: 'success', status: 201 });
    await finishSend(st, 'https://example.com/0', 'a', { kind: 'timeout', message: 'm' });
    const r = (await loadResults(st, 'https://example.com/0')).results;
    expect(r.a!.outcome.kind).toBe('timeout');
    expect(r.b!.outcome.kind).toBe('success');
    for (let i = 1; i <= MAX_RESULT_URLS; i++) await finishSend(st, `https://example.com/${i}`, 'a', { kind: 'success', status: 200 });
    expect((await loadResults(st, 'https://example.com/0')).results).toEqual({});
    expect(Object.keys((await loadResults(st, `https://example.com/${MAX_RESULT_URLS}`)).results)).toEqual(['a']);
  });

  it('ignores stale in-flight markers', async () => {
    const st = fakeStorage();
    let t = 0;
    expect(await beginSend(st, TAB, 'a', () => t)).toBe(true);
    expect(await beginSend(st, TAB, 'a', () => t)).toBe(false);
    t = 60_000;
    expect(await beginSend(st, TAB, 'a', () => t)).toBe(true);
  });
});

describe('messages', () => {
  const ORIGIN = 'chrome-extension://ext/';
  const sender = { id: 'ext', url: `${ORIGIN}popup.html` };
  it('ignores unknown messages, foreign senders and content scripts', () => {
    const s = setup();
    const listener = createSendListener({ extensionId: 'ext', extensionOrigin: ORIGIN, deps: s.deps });
    const respond = vi.fn();
    const msg = { type: SEND_MESSAGE_TYPE, tabUrl: TAB, projectId: 'p1', targetId: 'a', payload: payloadFor('p1', 'a') };
    expect(listener({ type: 'other' }, sender, respond)).toBe(false);
    expect(listener('x', sender, respond)).toBe(false);
    expect(listener({ ...msg, targetId: 5 }, sender, respond)).toBe(false);
    expect(listener(msg, { id: 'evil' }, respond)).toBe(false);
    expect(listener(msg, {}, respond)).toBe(false);
    // A content script carries the extension id but the page url.
    expect(listener(msg, { id: 'ext', url: 'https://example.com/' }, respond)).toBe(false);
    expect(listener(msg, { id: 'ext', url: 'chrome-extension://other/popup.html' }, respond)).toBe(false);
    expect(createSendListener({ extensionId: 'ext', extensionOrigin: undefined, deps: s.deps })(msg, sender, respond)).toBe(false);
    expect(s.fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the channel open and answers; url/headers on the message have no effect', async () => {
    const s = setup();
    const listener = createSendListener({ extensionId: 'ext', extensionOrigin: ORIGIN, deps: s.deps });
    const response = new Promise((resolve) => {
      const keep = listener(
        { type: SEND_MESSAGE_TYPE, tabUrl: TAB, projectId: 'p1', targetId: 'a', payload: payloadFor('p1', 'a'), url: 'https://evil.example.net/', headers: { 'X-Token': 'x', Authorization: 'y' } },
        sender,
        resolve,
      );
      expect(keep).toBe(true);
    });
    expect(await response).toEqual({ kind: 'success', status: 200 });
    const [url, init] = s.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/a');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Token': 'secret-a' });
  });

  it('requestSend resolves with the outcome and never rejects', async () => {
    const sent = vi.fn(async () => ({ kind: 'success', status: 200 }));
    expect(await requestSend(req('p1', 'a'), sent)).toEqual({ kind: 'success', status: 200 });
    expect(Object.keys((sent.mock.calls[0] as unknown[])[0] as object).sort()).toEqual(['payload', 'projectId', 'tabUrl', 'targetId', 'type']);
    expect((await requestSend(req('p1', 'a'), async () => { throw new Error('x'); })).kind).toBe('internal-error');
    expect((await requestSend(req('p1', 'a'), async () => undefined)).kind).toBe('internal-error');
  });
});
