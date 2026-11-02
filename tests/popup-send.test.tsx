// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, type StorageArea } from '../src/config';
import type { ReadTabResult } from '../src/extract/inject';
import { PopupApp, type PopupDeps } from '../src/popup/PopupApp';
import { IN_FLIGHT_KEY, RESULTS_KEY } from '../src/send/results';
import type { SendOutcome } from '../src/send/response';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} }, tabs: {}, runtime: {} } }));

afterEach(cleanup);

const URL_A = 'https://example.com/a';

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const target = { id: 't1', name: 'Hook', url: 'https://hooks.example.com/in', headers: [], purpose: '' };
const config = (targets: unknown[] = [target]) => ({
  [CONFIG_KEY]: {
    schemaVersion: 1,
    projects: [
      {
        id: 'p', name: 'Alpha', scope: { allSites: true, domains: [] }, siteMappings: {}, targets,
        fields: [
          { key: 'title', label: 'Headline', required: true, sources: {} },
          { key: 'price', label: 'Price', required: false, sources: {} },
        ],
      },
    ],
  },
});

const read = async (fields: Record<string, { value: string; source: string }>): Promise<ReadTabResult> => ({
  ok: true,
  result: {
    title: 'Article', url: URL_A, content: '# Body', contentFormat: 'markdown', contentTruncated: false, jsonLdTypes: [],
    matchingProjects: [{ id: 'p', name: 'Alpha' }], selectedProjectId: 'p', fields,
  } as never,
});

const success: SendOutcome = { kind: 'success', status: 201, message: 'Saved <b>ok</b>', url: 'https://example.com/item/1' };

function setup(over: Partial<PopupDeps> & { targets?: unknown[]; fields?: Record<string, { value: string; source: string }>; results?: Record<string, unknown> } = {}) {
  const resultStorage = over.resultStorage ?? fakeStorage(over.results);
  const deps: PopupDeps = {
    storage: fakeStorage(config(over.targets)),
    draftStorage: fakeStorage(),
    read: async () => read(over.fields ?? { title: { value: 'Read title', source: 'meta' } }),
    getActiveTab: async () => ({ id: 7, url: URL_A }),
    pick: vi.fn(async () => undefined),
    openOptions: vi.fn(async () => undefined),
    close: vi.fn(),
    permissions: { contains: vi.fn(async () => true) },
    resultStorage,
    send: vi.fn(async () => success),
    pollMs: 20,
    ...over,
  };
  const user = userEvent.setup();
  render(<PopupApp {...deps} />);
  return { user, deps, resultStorage: resultStorage as ReturnType<typeof fakeStorage> };
}

const SENT = /^Sent at /;
const sendButton = () => screen.findByRole('button', { name: 'Send to Hook' });

describe('popup send', () => {
  it('shows a hint without targets', async () => {
    setup({ targets: [] });
    expect(await screen.findByText('This project has no target yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Send to/ })).toBeNull();
  });

  it('keeps line breaks of a multi-line value when shown, edited and sent', async () => {
    const value = '**Contact**\nErika Example\nhead of purchasing';
    const { user, deps } = setup({ fields: { title: { value, source: 'selector' } } });
    const area = (await screen.findByLabelText(/^Headline/)) as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.value).toBe(value);
    await user.type(area, '{Enter}info@example.com');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    await screen.findByText(SENT);
    const req = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req.payload.fields.title).toBe(`${value}\ninfo@example.com`);
  });

  it('blocks an empty required field and marks it invalid', async () => {
    const { user, deps } = setup({ fields: {} });
    await user.click(await sendButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Please fill in the marked required fields.');
    expect(deps.send).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Headline/).getAttribute('aria-invalid')).toBe('true');
    // Whitespace only counts as empty; fixing the field clears the hint.
    await user.type(screen.getByLabelText(/^Headline/), '  ');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    expect(deps.send).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/^Headline/), 'x');
    expect(screen.queryByText(/Required fields missing/)).toBeNull();
    expect(screen.getByLabelText(/^Headline/).getAttribute('aria-invalid')).toBeNull();
  });

  it('blocks without host permission and offers the options page', async () => {
    const { user, deps } = setup({ permissions: { contains: vi.fn(async () => false) } });
    await user.click(await sendButton());
    const open = await screen.findByRole('button', { name: /Grant permission/ });
    expect(deps.send).not.toHaveBeenCalled();
    await user.click(open);
    expect(deps.openOptions).toHaveBeenCalledTimes(1);
  });

  it('shows the permission hint for a stored no-permission outcome', async () => {
    setup({
      results: { [RESULTS_KEY]: [{ url: URL_A, targets: { t1: { outcome: { kind: 'no-permission', message: 'x' }, at: '2026-01-01T00:00:00.000Z' } } }] },
    });
    expect(await screen.findByRole('button', { name: /Grant permission/ })).toBeTruthy();
  });

  it('sends the built payload and shows status, message text and link', async () => {
    const { user, deps } = setup();
    const title = (await screen.findByLabelText(/^Headline/)) as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Edited');
    await user.type(screen.getByLabelText('Note'), 'my note');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    expect(await screen.findByText(SENT)).toBeTruthy();
    expect(deps.send).toHaveBeenCalledTimes(1);
    const req = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req).toMatchObject({ tabUrl: URL_A, projectId: 'p', targetId: 't1' });
    expect(Object.keys(req.payload).sort()).toEqual(
      ['captured_at', 'content', 'content_format', 'fields', 'note', 'project', 'target', 'title', 'url', 'version'],
    );
    expect(req.payload).toMatchObject({
      fields: { title: 'Edited', price: '' }, note: 'my note', title: 'Article', url: URL_A, content: '# Body', content_format: 'markdown',
    });
    expect(screen.getByText('Saved <b>ok</b>')).toBeTruthy();
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/item/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows a non-http url as text, not as a link', async () => {
    const outcome = { kind: 'success', status: 200, url: 'javascript:void(0)' };
    setup({ results: { [RESULTS_KEY]: [{ url: URL_A, targets: { t1: { outcome, at: '2026-01-01T00:00:00.000Z' } } }] } });
    expect(await screen.findByText('javascript:void(0)')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sends once on two quick clicks and disables the button while pending', async () => {
    let resolve!: (o: SendOutcome) => void;
    const send = vi.fn(() => new Promise<SendOutcome>((r) => (resolve = r)));
    const { deps } = setup({ send });
    const button = (await sendButton()) as HTMLButtonElement;
    button.click();
    button.click();
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(deps.send).toHaveBeenCalledTimes(1);
    resolve(success);
    await screen.findByText(SENT);
    expect(button.disabled).toBe(false);
  });

  it('disables the button while stored state lists the target in flight, then shows the outcome', async () => {
    const { resultStorage } = setup({
      results: { [IN_FLIGHT_KEY]: [{ url: URL_A, targetId: 't1', startedAt: Date.now() }] },
    });
    const button = (await screen.findByRole('button', { name: /Sending/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    resultStorage.data[IN_FLIGHT_KEY] = [];
    resultStorage.data[RESULTS_KEY] = [{ url: URL_A, targets: { t1: { outcome: success, at: '2026-01-01T00:00:00.000Z' } } }];
    await screen.findByText(SENT);
    expect(button.disabled).toBe(false);
  });

  it('shows http errors with a catalog title, the response text as text, and retries to the same target', async () => {
    const send = vi.fn(async (): Promise<SendOutcome> => ({ kind: 'http-error', status: 422, text: '<i>bad</i> input' }));
    const { user } = setup({ send });
    await user.click(await sendButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The target answered with error 422.');
    expect(screen.getByText('<i>bad</i> input')).toBeTruthy();
    expect(alert.querySelector('i')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect((send.mock.calls[1] as unknown[])[0]).toMatchObject({ projectId: 'p', targetId: 't1' });
  });

  it.each([
    ['network-error', 'The target cannot be reached.'],
    ['timeout', 'The target did not answer in time.'],
    ['unknown-target', 'This target no longer belongs to the project.'],
    ['invalid-request', 'The request was invalid.'],
    ['internal-error', 'Sending failed.'],
  ] as const)('shows the catalog text for %s, not the fixed message, and offers a retry', async (kind, expected) => {
    const send = vi.fn(async (): Promise<SendOutcome> => ({ kind, message: 'Fixed English message from the core.' }));
    const { user } = setup({ send });
    await user.click(await sendButton());
    expect((await screen.findByRole('alert')).textContent).toContain(expected);
    expect(screen.queryByText(/Fixed English message/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it('shows the sending state with text and a locked button', async () => {
    const send = vi.fn(() => new Promise<SendOutcome>(() => undefined));
    const { user } = setup({ send });
    await user.click(await sendButton());
    const button = await screen.findByRole('button', { name: /Sending/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector('.q-spinner')).toBeTruthy();
  });

  it('keeps html in the success message as text and shows the time', async () => {
    const { user } = setup();
    await user.click(await sendButton());
    expect(await screen.findByText('Saved <b>ok</b>')).toBeTruthy();
    expect(document.querySelector('.popup-outcome b')).toBeNull();
    expect(screen.queryByText(/201/)).toBeNull();
  });

  it('shows a stored outcome after remount', async () => {
    const first = setup();
    await first.user.click(await sendButton());
    await screen.findByText(SENT);
    // The real send core stores the outcome; the fake send does not, so emulate it.
    first.resultStorage.data[RESULTS_KEY] = [{ url: URL_A, targets: { t1: { outcome: success, at: '2026-01-01T00:00:00.000Z' } } }];
    cleanup();
    setup({ resultStorage: first.resultStorage });
    expect(await screen.findByText(SENT)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com/item/1');
  });
});
