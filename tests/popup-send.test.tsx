// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_KEY, exportConfig, type StorageArea } from '../src/config';
import { LAST_TARGETS_KEY, pickTarget, shortAddress } from '../src/popup/lastTarget';
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
    const area = (await screen.findByLabelText(/^Headline \(required\)$/)) as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.value).toBe(value);
    await user.type(area, '{Enter}info@example.com');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    await screen.findByText(SENT);
    const req = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req.payload.fields.title).toBe(`${value}\ninfo@example.com`);
  });

  it('sends a value edited in the long-value preview', async () => {
    const value = Array.from({ length: 7 }, (_, i) => `row ${i}`).join('\n');
    const { user, deps } = setup({ fields: { title: { value, source: 'selector' } } });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit Headline' }), '!');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    await screen.findByText(SENT);
    const req = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req.payload.fields.title).toBe(`${value}!`);
  });

  it('blocks an empty required field and marks it invalid', async () => {
    const { user, deps } = setup({ fields: {} });
    await user.click(await sendButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Please fill in the marked required fields.');
    expect(deps.send).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Headline \(required\)$/).getAttribute('aria-invalid')).toBe('true');
    // Whitespace only counts as empty; fixing the field clears the hint.
    await user.type(screen.getByLabelText(/^Headline \(required\)$/), '  ');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    expect(deps.send).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/^Headline \(required\)$/), 'x');
    expect(screen.queryByText(/Required fields missing/)).toBeNull();
    expect(screen.getByLabelText(/^Headline \(required\)$/).getAttribute('aria-invalid')).toBeNull();
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
    const title = (await screen.findByLabelText(/^Headline \(required\)$/)) as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Edited');
    await user.type(screen.getByLabelText('Note'), 'my note');
    await user.click(screen.getByRole('button', { name: 'Send to Hook' }));
    expect(await screen.findByText(SENT)).toBeTruthy();
    expect(deps.send).toHaveBeenCalledTimes(1);
    const req = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req).toMatchObject({ tabUrl: URL_A, projectId: 'p', targetId: 't1' });
    expect(Object.keys(req.payload).sort()).toEqual(
      ['captured_at', 'content', 'content_format', 'domain', 'fields', 'note', 'project', 'target', 'title', 'url', 'version'],
    );
    expect(req.payload).toMatchObject({
      fields: { title: 'Edited', price: '' }, note: 'my note', title: 'Article', url: URL_A, domain: 'example.com', content: '# Body', content_format: 'markdown',
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

const second = { id: 't2', name: 'Second', url: 'https://second.example.com/api/hook?token=SECRET#frag', headers: [], purpose: '' };
const withLast = (targets: unknown[], last: unknown) => fakeStorage({ ...config(targets), [LAST_TARGETS_KEY]: last });
const sentTo = (deps: PopupDeps) => (deps.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { targetId: string }).targetId);
const arrow = () => screen.findByRole('button', { name: 'Choose target to send to' });

describe.each(['popup', 'sidepanel'] as const)('send control in the fixed head (%s)', (variant) => {
  it('shows one icon button with the target in name and tooltip, no arrow, and sends to it', async () => {
    const { user, deps } = setup({ variant });
    const button = await sendButton();
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose target to send to' })).toBeNull();
    await user.hover(button);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Send to Hook');
    await user.click(button);
    await screen.findByText(SENT);
    expect(sentTo(deps)).toEqual(['t1']);
  });

  it('puts the send button last in the head and the result directly below it', async () => {
    const { user } = setup({ variant });
    await user.click(await sendButton());
    const status = await screen.findByText(SENT);
    const header = document.querySelector('header.popup-header')!;
    const focusable = Array.from(header.querySelectorAll('input, button')).map((n) => n.getAttribute('aria-label') ?? n.getAttribute('role'));
    expect(focusable[0]).toBe('combobox');
    expect(focusable[focusable.length - 1]).toBe('Send to Hook');
    expect(header.nextElementSibling?.contains(status)).toBe(true);
    expect(header.nextElementSibling?.textContent).toContain('Target: Hook');
  });

  it('sends to the first target without a remembered one and uses the arrow only with several targets', async () => {
    const { user, deps } = setup({ variant, targets: [target, second] });
    await user.click(await sendButton());
    await screen.findByText(SENT);
    expect(sentTo(deps)).toEqual(['t1']);
    expect(await arrow()).toBeTruthy();
  });

  it('sends to the remembered target of this project with the main part', async () => {
    const { user, deps } = setup({ variant, targets: [target, second], storage: withLast([target, second], { p: 't2' }) });
    await user.click(await screen.findByRole('button', { name: 'Send to Second' }));
    await screen.findByText(SENT);
    expect(sentTo(deps)).toEqual(['t2']);
  });

  it('ignores a remembered target that no longer exists or belongs to another project', async () => {
    const { user, deps } = setup({ variant, targets: [target, second], storage: withLast([target, second], { p: 'gone', other: 't2' }) });
    await user.click(await sendButton());
    await screen.findByText(SENT);
    expect(sentTo(deps)).toEqual(['t1']);
    expect(pickTarget([target], { p: 't2' }, 'p')).toBe(target);
    expect(pickTarget([target, second], { other: 't2' }, 'p')).toBe(target);
  });

  it('lists name and shortened address in the menu, sends at once on choice and remembers it', async () => {
    const storage = withLast([target, second], {});
    const { user, deps } = setup({ variant, targets: [target, second], storage });
    await user.click(await arrow());
    const item = await screen.findByRole('menuitem', { name: /Second/ });
    expect(item.textContent).toContain('second.example.com/api/hook');
    expect(item.textContent).not.toMatch(/SECRET|token|frag/);
    await user.click(item);
    await screen.findByText(SENT);
    expect(sentTo(deps)).toEqual(['t2']);
    expect(storage.data[LAST_TARGETS_KEY]).toEqual({ p: 't2' });
    expect(document.querySelector('header.popup-header')!.nextElementSibling?.textContent).toContain('Target: Second');
    expect(await screen.findByRole('button', { name: 'Send to Second' })).toBeTruthy();
  });

  it('keeps the remembered target out of the export', async () => {
    const storage = withLast([target, second], {});
    const { user } = setup({ variant, targets: [target, second], storage });
    await user.click(await arrow());
    await user.click(await screen.findByRole('menuitem', { name: /Second/ }));
    await screen.findByText(SENT);
    expect(storage.data[LAST_TARGETS_KEY]).toEqual({ p: 't2' });
    const exported = await exportConfig(storage);
    expect(exported).not.toContain('popupLastTargets');
  });

  it('shows missing required fields and missing permission under the head with the target name', async () => {
    const first = setup({ variant, fields: {} });
    await first.user.click(await sendButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Target: Hook');
    expect(document.querySelector('header.popup-header')!.nextElementSibling?.contains(alert)).toBe(true);
    cleanup();
    const { user } = setup({ variant, permissions: { contains: vi.fn(async () => false) } });
    await user.click(await sendButton());
    const hint = await screen.findByRole('alert');
    expect(hint.textContent).toContain('Target: Hook');
    expect(document.querySelector('header.popup-header')!.nextElementSibling?.contains(hint)).toBe(true);
  });

  it('sends once on a double click and announces the busy state at the button', async () => {
    let resolve!: (o: SendOutcome) => void;
    const send = vi.fn(() => new Promise<SendOutcome>((r) => (resolve = r)));
    const { deps } = setup({ variant, send });
    const button = (await sendButton()) as HTMLButtonElement;
    button.click();
    button.click();
    const busy = (await screen.findByRole('button', { name: 'Sending to Hook' })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Sending to Hook');
    expect(deps.send).toHaveBeenCalledTimes(1);
    resolve(success);
    await screen.findByText(SENT);
  });

  it('has no send button without a target', async () => {
    setup({ variant, targets: [] });
    expect(await screen.findByText('This project has no target yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Send to/ })).toBeNull();
  });
});

describe('shortAddress', () => {
  it('keeps host and path start only', () => {
    const withCredentials = new URL('https://hooks.example.com/a/b?token=x#y');
    withCredentials.username = 'user';
    withCredentials.password = 'pw';
    expect(shortAddress(withCredentials.href)).toBe('hooks.example.com/a/b');
    expect(shortAddress('https://hooks.example.com/')).toBe('hooks.example.com');
    expect(shortAddress('https://hooks.example.com/' + 'x'.repeat(80)).length).toBe(32);
    expect(shortAddress('not a url')).toBe('');
  });
});
