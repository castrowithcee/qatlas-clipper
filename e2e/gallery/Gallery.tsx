import { useState, type ReactNode } from 'react';
import { useI18n } from '../../src/settings';
import {
  Button, Checkbox, Chip, Dialog, Disclosure, EmptyState, ErrorState, ICON_NAMES, Icon, IconButton, LoadingState, Select, Switch, TextField, Toast, Tooltip,
} from '../../src/ui/components';
import '../../src/ui/components/components.css';

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section data-testid={id} className="gallery-section">
    <h2>{title}</h2>
    <div className="gallery-row">{children}</div>
  </section>
);

const OPTIONS = [{ value: 'a', label: 'Article' }, { value: 'b', label: 'Product' }];

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
        .gallery-chips { display: flex; gap: var(--space-2); padding: 0; margin: 0; list-style: none; }
        .gallery-icons { display: flex; gap: var(--space-3); }
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
          <Tooltip content="Longer explanation that appears on focus or hover and closes with Escape.">
            {(p) => <IconButton icon="info" label={i18n.t('ui.moreInfo')} {...p} data-testid="tooltip-trigger" />}
          </Tooltip>
        </div>
      </Section>
      <Section id="toasts" title="Toast">
        <Toast kind="info">Configuration imported</Toast>
        <Toast kind="success" onDismiss={() => {}}>Sent to the webhook</Toast>
        <Toast kind="warning">Permission is still missing</Toast>
        <Toast kind="error" onDismiss={() => {}}>The webhook did not respond</Toast>
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
      <Section id="chips" title="Chips">
        <ul className="gallery-chips">
          <Chip label="example.com" removeLabel="Remove example.com" onRemove={() => {}} />
          <Chip label="example.org" removeLabel="Remove example.org" onRemove={() => {}} />
        </ul>
      </Section>
      <Section id="icons" title="Icons">
        <div className="gallery-icons">{ICON_NAMES.map((n) => <Icon key={n} name={n} />)}</div>
      </Section>
    </main>
  );
}
