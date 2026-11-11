import { useState, type ReactNode, type Ref } from 'react';
import { useI18n } from '../../src/settings';
import {
  Button, Checkbox, Chip, Combobox, type ComboboxGroup, DataTable, DetailPanel, Dialog, Disclosure, EmptyState, ErrorState, ICON_NAMES, Icon, IconButton, LoadingState, Menu, type MenuEntry, type MenuTriggerProps, NotificationsProvider, RowActions, RowError, Select, Switch, TextField, Toast, TileGroup, useNotifications,
} from '../../src/ui/components';
import '../../src/ui/components/components.css';
import '../../src/options/options.css';
import { moveTo } from '../../src/options/draft';
import { useReorder } from '../../src/options/reorder';

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section data-testid={id} className="gallery-section">
    <h2>{title}</h2>
    <div className="gallery-row">{children}</div>
  </section>
);

// The area itself sits fixed at the top of the window; these buttons show it live.
function NotifyDemo() {
  const { notify } = useNotifications();
  return (
    <div className="gallery-row">
      <Button onClick={() => notify('success', 'Saved.')}>Show message</Button>
      <Button onClick={() => notify('error', 'Not saved: the webhook did not respond')}>Show error</Button>
    </div>
  );
}

const PICK_GROUPS: ComboboxGroup[] = [
  { id: 'page', label: 'Fits this page', options: [{ value: 'a', label: 'Articles · News' }] },
  { id: 'loose', label: 'No folder', options: [{ value: 'b', label: 'Products' }] },
  { id: 'f1', label: 'Reviews', icon: 'folder', options: [{ value: 'c', label: 'Books' }, { value: 'd', label: 'Films' }] },
];

function ComboboxDemo() {
  const [text, setText] = useState('');
  const [value, setValue] = useState('a');
  const needle = text.trim().toLowerCase();
  const groups = PICK_GROUPS.map((g) => ({ ...g, options: g.options.filter((o) => g.label?.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle)) }));
  const chosen = PICK_GROUPS.flatMap((g) => g.options).find((o) => o.value === value);
  return (
    <div className="gallery-combobox">
      <Combobox
        label="Project" text={text} onTextChange={setText} groups={groups} listLabel="Projects" emptyText="No projects" noResultsText="No matches"
        selectedValue={value} closedText={chosen?.label ?? ''} icon="project" autoActivate onSelect={(v) => { setValue(v); setText(''); }} onCancel={() => setText('')}
      />
    </div>
  );
}

const OPTIONS = [{ value: 'a', label: 'Article' }, { value: 'b', label: 'Product' }];

function TileGroupDemo() {
  const [v, setV] = useState<'system' | 'light' | 'dark'>('light');
  return (
    <TileGroup
      legend="Appearance"
      value={v}
      onChange={setV}
      options={[{ value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]}
    />
  );
}

const ROWS = [
  { label: 'Title', source: 'auto' as const, sourceName: 'Detected automatically', format: 'Text', required: true, sites: 2, error: false },
  { label: 'Summary', source: 'click-mapped' as const, sourceName: 'Assigned by click', format: 'Markdown', required: false, sites: 1, error: false },
  { label: 'Author', source: 'pencil' as const, sourceName: 'Enter it yourself', format: 'Text', required: false, sites: 0, error: true },
];

function TableDemo() {
  const i18n = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState(ROWS);
  const reorder = useReorder({
    sizeOf: () => rows.length,
    onMove: ({ from, to }) => setRows(moveTo(rows, from.index, to.index)),
    announce: ({ from, to }) => `${rows[from.index]?.label}: position ${to.index + 1} of ${rows.length}`,
  });
  return (
    <>
      <DataTable
        caption="Fields"
        columns={[{ label: 'Move', hidden: true, narrow: true }, 'Label', { label: 'Source', narrow: true }, 'Format', 'Required', 'Websites', { label: 'Actions', hidden: true, narrow: true }]}
      >
        {rows.map((r, i) => {
          const { row, grip } = reorder.item(r.label, r.label, i);
          return (
          <tr key={r.label} data-invalid={r.error || undefined} className={['options-field-row', row.className].filter(Boolean).join(' ')} onDragOver={row.onDragOver} onDrop={row.onDrop}>
            <td><IconButton {...grip} icon="grip-vertical" label={`Move ${r.label}`} className="options-grip" /></td>
            <td>
              {r.label}
              {r.error && <div><RowError>Label is missing</RowError></div>}
            </td>
            <td><Icon name={r.source} label={r.sourceName} /></td>
            <td>{r.format}</td>
            <td>{r.required ? 'Yes' : 'No'}</td>
            <td>{r.sites}</td>
            <td>
              <RowActions>
                <IconButton icon="chevron-right" label={`Open ${r.label}`} onClick={() => setOpen(r.label)} data-testid={`row-open-${r.label}`} />
              </RowActions>
            </td>
          </tr>
          );
        })}
      </DataTable>
      <p className="q-sr-only" role="status">{reorder.announcement}</p>
      <DetailPanel
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ?? ''}
        actions={<Button variant="danger" icon="trash">Delete field</Button>}
      >
        <TextField label="Label" defaultValue={open ?? ''} />
        <Select label="Format" options={[{ value: 'text', label: 'Text' }, { value: 'markdown', label: 'Markdown' }]} defaultValue="text" />
        <Button onClick={() => setOpen(null)}>{i18n.t('ui.close')}</Button>
      </DetailPanel>
    </>
  );
}

const MENU_ENTRIES: MenuEntry[] = [
  { kind: 'action', label: 'Rename', icon: 'pencil', onSelect: () => {} },
  { kind: 'action', label: 'Move up', icon: 'arrow-up', disabled: true, onSelect: () => {} },
  { kind: 'separator' },
  { kind: 'checkbox', label: 'Required', checked: true, onSelect: () => {} },
  { kind: 'checkbox', label: 'Hidden', checked: false, onSelect: () => {} },
  { kind: 'separator' },
  { kind: 'action', label: 'Delete', icon: 'trash', danger: true, onSelect: () => {} },
];

function ActionsTrigger({ ref, ...props }: MenuTriggerProps) {
  return (
    <button type="button" ref={ref as Ref<HTMLButtonElement>} className="q-button q-button--secondary" data-testid="menu-custom" {...props}>
      Actions <Icon name="chevron-down" />
    </button>
  );
}

export function Gallery() {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <main>
      <style>{`
        body { margin: 0; font-family: var(--font-sans); font-size: var(--font-size-base); line-height: var(--line-height); background: var(--color-bg); color: var(--color-text); }
        main { max-width: 44rem; padding: var(--space-5); }
        h1, h2 { margin: 0 0 var(--space-3); }
        h2 { font-size: 1.1em; }
        .gallery-section { padding: var(--space-4) 0 var(--space-5); border-bottom: 1px solid var(--color-border); }
        .gallery-row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: flex-start; }
        .gallery-row > .q-field { flex: 1 1 14rem; }
        .gallery-combobox { flex: 1 1 20rem; max-width: 28rem; }
        .gallery-chips { display: flex; gap: var(--space-2); padding: 0; margin: 0; list-style: none; }
        .gallery-icons { display: flex; flex-wrap: wrap; gap: var(--space-3); }
        .gallery-icons .q-icon { width: 1.5rem; height: 1.5rem; }
      `}</style>
      <h1>Components</h1>
      <Section id="buttons" title="Button">
        <Button variant="primary">Save</Button>
        <Button>Cancel</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="primary" icon="plus">Add</Button>
        <IconButton icon="close" label={i18n.t('ui.close')} />
        <Button variant="primary" disabled>Save</Button>
        <Button disabled>Cancel</Button>
        <Button variant="danger" disabled>Delete</Button>
        <IconButton icon="close" label={i18n.t('ui.close')} disabled />
      </Section>
      <Section id="fields" title="Text field and select">
        <TextField label="Project name" defaultValue="Articles" hint="Shown in the project list" />
        <TextField label="Webhook URL" type="url" defaultValue="example.com" error="Enter a full URL, for example https://example.com/hook" />
        <TextField label="Disabled" defaultValue="Locked" disabled />
        <Select label="Template" options={OPTIONS} defaultValue="a" help="The template decides which fields are read first." />
        <Select label="Template" options={OPTIONS} defaultValue="b" error="Choose a template that matches the page" />
        <Select label="Disabled" options={OPTIONS} disabled />
      </Section>
      <Section id="combobox" title="Combobox">
        <ComboboxDemo />
      </Section>
      <Section id="toggles" title="Switch and checkbox">
        <Switch label="Send automatically" defaultChecked />
        <Switch label="Send automatically" />
        <Switch label="Disabled" disabled />
        <Checkbox label="Include page title" defaultChecked />
        <Checkbox label="Include page title" />
        <Checkbox label="Accept terms" error="This is required" />
        <Checkbox label="Disabled" disabled />
      </Section>
      <Section id="tooltip" title="Tooltip">
        <div style={{ paddingBottom: '4rem' }}>
          <IconButton icon="info" label={i18n.t('ui.moreInfo')} tooltip="Longer explanation that appears on focus or hover and closes with Escape." data-testid="tooltip-trigger" />
          <IconButton icon="settings" label="Open settings" data-testid="tooltip-default" />
        </div>
      </Section>
      <Section id="toasts" title="Toast">
        <Toast kind="info">Configuration imported</Toast>
        <Toast kind="success" onDismiss={() => {}}>Sent to the webhook</Toast>
        <Toast kind="warning">Permission is still missing</Toast>
        <Toast kind="error" onDismiss={() => {}}>The webhook did not respond</Toast>
        <NotificationsProvider>
          <NotifyDemo />
        </NotificationsProvider>
      </Section>
      <Section id="states" title="Empty, loading and error">
        <EmptyState title="No projects yet" description="Create a project to start clipping" action={<Button variant="primary" icon="plus">New project</Button>} />
        <LoadingState />
        <ErrorState message="The page could not be read" onRetry={() => {}} />
      </Section>
      <Section id="disclosure" title="Advanced">
        <Disclosure><TextField label="Timeout in seconds" type="number" defaultValue="10" /></Disclosure>
        <Disclosure defaultOpen><TextField label="Timeout in seconds" type="number" defaultValue="10" /></Disclosure>
      </Section>
      <Section id="dialog" title="Dialog">
        <Button data-testid="dialog-open" onClick={() => setOpen(true)}>Delete project</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Delete project"
          actions={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => setOpen(false)}>Delete</Button></>}
        >
          The project and its field mappings will be removed. This cannot be undone.
        </Dialog>
      </Section>
      <Section id="table" title="Table and detail panel">
        <div style={{ width: '100%' }}><TableDemo /></div>
      </Section>
      <Section id="menu" title="Menu">
        <div style={{ minHeight: '16rem' }} className="gallery-row">
          <Menu label="Options" entries={MENU_ENTRIES} buttonProps={{ 'data-testid': 'menu-default' } as Record<string, string>} />
          <Menu
            label="Actions"
            entries={MENU_ENTRIES}
            trigger={ActionsTrigger}
          />
        </div>
      </Section>
      <Section id="chips" title="Chips">
        <ul className="gallery-chips">
          <Chip label="example.com" removeLabel="Remove example.com" onRemove={() => {}} />
          <Chip label="example.org" removeLabel="Remove example.org" onRemove={() => {}} />
        </ul>
      </Section>
      <Section id="tiles" title="Tile group">
        <TileGroupDemo />
      </Section>
      <Section id="icons" title="Icons">
        <div className="gallery-icons">{ICON_NAMES.map((n) => <Icon key={n} name={n} />)}</div>
      </Section>
    </main>
  );
}
