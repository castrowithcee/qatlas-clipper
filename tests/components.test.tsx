// @vitest-environment happy-dom
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button, Checkbox, Chip, DataTable, DetailPanel, Dialog, Disclosure, EmptyState, ErrorState, Icon, IconButton, LoadingState, Select, Switch, TextField, Toast, Tooltip, TileGroup, ICON_NAMES, type IconName, NotificationsProvider, TOAST_DURATION_MS, useNotifications, type ToastKind,
} from '../src/ui/components';
import { de, en } from '../src/i18n/catalog';

vi.mock('wxt/browser', () => ({ browser: { storage: { local: {} } } }));

afterEach(cleanup);

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/components.css'), 'utf8');

describe('stylesheet', () => {
  it('uses only tokens for colors and has a focus outline from the focus token', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^;}]*var\(--color-focus\)/);
  });
  it('drives all motion through --motion-duration', () => {
    const times = [...css.matchAll(/\b(?:transition|animation)[^;]*;/g)].map((m) => m[0]);
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) expect(t, t).toContain('var(--motion-duration)');
    expect(css).not.toMatch(/\d+m?s\b/);
  });
});

describe('Notifications', () => {
  afterEach(() => vi.useRealTimers());

  function Trigger({ kind, text = 'Hello' }: { kind: ToastKind; text?: string }) {
    const { notify } = useNotifications();
    return <button onClick={() => notify(kind, text)}>go</button>;
  }
  const show = (kind: ToastKind, text?: string) => {
    vi.useFakeTimers();
    render(<NotificationsProvider><Trigger kind={kind} text={text} /></NotificationsProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
  };
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('keeps the duration out of the stylesheet', () => {
    expect(TOAST_DURATION_MS).toBe(5000);
    expect(css).not.toMatch(/\b5s\b|5000/);
  });

  it.each(['success', 'info', 'warning'] as const)('%s closes after 5 seconds', (kind) => {
    show(kind);
    expect(screen.getByRole('status').textContent).toBe('Hello');
    wait(TOAST_DURATION_MS - 1);
    expect(screen.queryByRole('status')).not.toBeNull();
    wait(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('errors stay until closed with the close button', () => {
    show('error', 'Broken');
    wait(TOAST_DURATION_MS * 10);
    expect(screen.getByRole('alert').textContent).toBe('Broken');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pauses while hovered and continues afterwards', () => {
    show('success');
    const slot = screen.getByRole('status').parentElement!;
    wait(3000);
    fireEvent.mouseEnter(slot);
    wait(TOAST_DURATION_MS * 3);
    expect(screen.queryByRole('status')).not.toBeNull();
    fireEvent.mouseLeave(slot);
    wait(TOAST_DURATION_MS - 1);
    expect(screen.queryByRole('status')).not.toBeNull();
    wait(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pauses while focus is inside and continues after it leaves', () => {
    show('success');
    const close = screen.getByRole('button', { name: 'Close' });
    wait(3000);
    fireEvent.focus(close);
    wait(TOAST_DURATION_MS * 3);
    expect(screen.queryByRole('status')).not.toBeNull();
    fireEvent.blur(close);
    wait(TOAST_DURATION_MS);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('replaces an identical message instead of stacking it', () => {
    show('success');
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('Icon', () => {
  it('is decorative without a label and named with one', () => {
    const { container } = render(<><Icon name="info" /><Icon name="check" label="Done" /></>);
    const [a, b] = [...container.querySelectorAll('svg')];
    expect(a?.getAttribute('aria-hidden')).toBe('true');
    expect(a?.getAttribute('stroke')).toBe('currentColor');
    expect(b?.getAttribute('role')).toBe('img');
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
  });
  it('has distinct motifs for import, export, move and the two picker states', () => {
    for (const n of ['file-import', 'file-export', 'arrow-up', 'arrow-down', 'pick-element', 'click-mapped', 'folder-open', 'grip-vertical', 'ellipsis-vertical', 'sort', 'sort-asc', 'sort-desc', 'search', 'square']) {
      expect(ICON_NAMES).toContain(n);
    }
    const d = (name: IconName) => render(<Icon name={name} />).container.innerHTML;
    expect(new Set([d('file-import'), d('file-export'), d('arrow-up'), d('arrow-down'), d('pick-element'), d('click-mapped')]).size).toBe(6);
  });
  it('renders every icon', () => {
    for (const name of ICON_NAMES) expect(render(<Icon name={name} />).container.querySelector('svg > :is(path, circle, rect, line, polyline, ellipse), svg > * > *')).toBeTruthy();
  });
});

describe('Button', () => {
  it.each(['primary', 'secondary', 'danger'] as const)('%s variant is focusable and can be disabled', async (variant) => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<><Button variant={variant} onClick={onClick}>Save</Button><Button variant={variant} disabled>Off</Button></>);
    await user.tab();
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveProperty('className', expect.stringContaining(`q-button--${variant}`));
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
    const off = screen.getByRole('button', { name: 'Off' }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    await user.click(off);
    await user.tab();
    expect(document.activeElement).not.toBe(off);
  });
  it('icon button has an accessible name and a hidden icon', () => {
    render(<IconButton icon="plus" label="Add project" />);
    const button = screen.getByRole('button', { name: 'Add project' });
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent).toBe('');
  });
});

describe('fields', () => {
  it('TextField: label, focus, disabled and error wiring', async () => {
    const user = userEvent.setup();
    render(<><TextField label="Name" hint="Shown in the list" error="Name is required" /><TextField label="Off" disabled /></>);
    const input = screen.getByLabelText('Name');
    await user.tab();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Shown in the list', 'Name is required']);
    expect(document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[1]!)?.querySelector('svg')).toBeTruthy();
    expect((screen.getByLabelText('Off') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText('Off').getAttribute('aria-invalid')).toBeNull();
  });

  it('Select: label, options, change, error, disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <Select label="Language" options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} defaultValue="a" onChange={(e) => onChange(e.target.value)} error="Pick one" />
        <Select label="Off" options={[{ value: 'x', label: 'X' }]} disabled />
      </>,
    );
    const select = screen.getByLabelText('Language');
    await user.selectOptions(select, 'b');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toBe('Pick one');
    expect((screen.getByLabelText('Off') as HTMLSelectElement).disabled).toBe(true);
  });

  it('Select: groups render as optgroups after the plain options', () => {
    render(<Select label="Pick" options={[{ value: 'a', label: 'Alpha' }]} groups={[{ label: '<b>Team</b>', options: [{ value: 'b', label: 'Beta' }] }]} />);
    const select = screen.getByLabelText('Pick') as HTMLSelectElement;
    expect([...select.children].map((c) => c.tagName)).toEqual(['OPTION', 'OPTGROUP']);
    expect(select.querySelector('optgroup')?.label).toBe('<b>Team</b>');
    expect(select.querySelector('optgroup option')?.textContent).toBe('Beta');
  });

  it('Checkbox and Switch toggle with the keyboard, expose state and errors', async () => {
    const user = userEvent.setup();
    render(<><Checkbox label="Remember" error="Required" /><Switch label="Enabled" /><Switch label="Locked" disabled /></>);
    const check = screen.getByRole('checkbox', { name: 'Remember' }) as HTMLInputElement;
    const sw = screen.getByRole('switch', { name: 'Enabled' }) as HTMLInputElement;
    await user.tab();
    expect(document.activeElement).toBe(check);
    await user.keyboard(' ');
    expect(check.checked).toBe(true);
    expect(check.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(check.getAttribute('aria-describedby')!)?.textContent).toBe('Required');
    await user.tab();
    expect(document.activeElement).toBe(sw);
    await user.keyboard(' ');
    expect(sw.checked).toBe(true);
    expect((screen.getByRole('switch', { name: 'Locked' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Tooltip', () => {
  const setup = () =>
    render(
      <>
        <Tooltip content="Longer explanation">{(p) => <button {...p}>Trigger</button>}</Tooltip>
        <button>Other</button>
      </>,
    );

  it('is reachable by keyboard focus, described by the trigger and closes with Escape', async () => {
    const user = userEvent.setup();
    setup();
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip.hidden).toBe(true);
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    expect(document.activeElement).toBe(trigger);
    expect(tip.hidden).toBe(false);
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    expect(screen.getByRole('button', { name: 'Trigger' }).getAttribute('aria-describedby')).toBe(tip.id);
    await user.keyboard('{Escape}');
    expect(tip.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on blur and opens on hover', async () => {
    const user = userEvent.setup();
    setup();
    const tip = screen.getByRole('tooltip', { hidden: true });
    await user.tab();
    await user.tab();
    expect(tip.hidden).toBe(true);
    await user.hover(screen.getByRole('button', { name: 'Trigger' }));
    expect(tip.hidden).toBe(false);
    await user.unhover(screen.getByRole('button', { name: 'Trigger' }));
    expect(tip.hidden).toBe(true);
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Delete project" actions={<><Button>Cancel</Button><Button variant="danger">Delete</Button></>}>
          Are you sure?
        </Dialog>
      </>
    );
  }

  it('opens modally with a title, moves focus inside, wraps Tab, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    expect(document.querySelector('dialog')?.open).toBe(false);
    await user.click(opener);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading', { name: 'Delete project' }).id);
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Wrap forwards from the last and backwards from the first focusable element.
    screen.getByRole('button', { name: 'Delete' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    await user.keyboard('{Escape}');
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('closes with its close button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });
});

describe('DetailPanel', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <DetailPanel open={open} onClose={() => setOpen(false)} title="Title field">
          <input aria-label="Label" />
        </DetailPanel>
      </>
    );
  }

  it('opens as a modal side panel, closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const panel = document.querySelector('dialog')!;
    expect(panel.open).toBe(true);
    expect(panel.classList.contains('q-dialog--panel')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Title field' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(panel.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(panel.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe('DataTable', () => {
  it('renders a caption, scoped column headers and a labelled scroll region', () => {
    render(
      <DataTable caption="Fields" columns={['Label', { label: 'Actions', hidden: true }]}>
        <tr><td>Title</td><td /></tr>
      </DataTable>,
    );
    const table = screen.getByRole('table', { name: 'Fields' });
    expect(table.querySelector('caption')?.textContent).toBe('Fields');
    const heads = [...table.querySelectorAll('th')];
    expect(heads.map((h) => h.textContent)).toEqual(['Label', 'Actions']);
    for (const h of heads) expect(h.getAttribute('scope')).toBe('col');
    expect(screen.getByRole('region', { name: 'Fields' }).tabIndex).toBe(0);
  });
});

describe('Toast and states', () => {
  it('toast uses alert for errors and status otherwise, with an icon next to the text', () => {
    render(<><Toast kind="error">Failed</Toast><Toast kind="success">Saved</Toast><Toast kind="warning">Careful</Toast><Toast>FYI</Toast></>);
    expect(screen.getByRole('alert').textContent).toBe('Failed');
    expect(screen.getByRole('alert').querySelector('svg')).toBeTruthy();
    expect(screen.getAllByRole('status').map((e) => e.textContent)).toEqual(['Saved', 'Careful', 'FYI']);
  });

  it('toast can be dismissed with the keyboard', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Toast onDismiss={onDismiss}>Hello</Toast>);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('empty, loading and error states', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<><EmptyState title="No projects" description="Create one" action={<Button>Create</Button>} /><LoadingState /><ErrorState message="Network down" onRetry={retry} /></>);
    expect(screen.getByText('No projects')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading …');
    expect(screen.getByRole('alert').textContent).toContain('Network down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('Disclosure', () => {
  it('toggles with the keyboard and reflects aria-expanded', async () => {
    const user = userEvent.setup();
    render(<Disclosure><p>Hidden detail</p></Disclosure>);
    const toggle = screen.getByRole('button', { name: 'Advanced' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hidden).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Hidden detail')).toBeTruthy();
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hidden).toBe(false);
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('component catalog keys', () => {
  it('exist in de and en', () => {
    for (const key of ['ui.close', 'ui.moreInfo', 'ui.advanced', 'ui.loading', 'ui.error', 'ui.retry', 'settings.help']) {
      expect(key in de && key in en, key).toBe(true);
    }
  });
});

describe('Chip', () => {
  it('shows the value and removes it through a named button', async () => {
    const onRemove = vi.fn();
    render(<ul><Chip label="example.com" removeLabel="Remove example.com" onRemove={onRemove} /></ul>);
    expect(screen.getByRole('listitem').textContent).toBe('example.com');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove example.com' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('TileGroup', () => {
  function Demo() {
    const [v, setV] = useState('a');
    return <TileGroup legend="Mode" value={v} onChange={setV} options={[{ value: 'a', label: 'One', icon: 'sun' }, { value: 'b', label: 'Two', icon: 'moon' }]} />;
  }
  it('is a labelled group; click and arrow keys change the selection', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(screen.getByRole('group', { name: 'Mode' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'One' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Two' }));
    expect((screen.getByRole('radio', { name: 'Two' }) as HTMLInputElement).checked).toBe(true);
    screen.getByRole('radio', { name: 'Two' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect((screen.getByRole('radio', { name: 'One' }) as HTMLInputElement).checked).toBe(true);
  });
});
