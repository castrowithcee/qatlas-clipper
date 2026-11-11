import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import type { HeaderValues, Target } from '../config';
import { useI18n } from '../settings';
import { Button, Checkbox, DataTable, DetailPanel, Disclosure, EmptyState, Icon, IconButton, RowActions, RowError, TextField, Tooltip } from '../ui/components';
import { accessKeyState, setAccessKey } from './accessKey';
import { errorsAt, moveTo, newTarget, shortAddress, type Issue } from './draft';
import { useReorder } from './reorder';
import { originPattern, type PermissionStatus } from './permissions';

interface Props {
  targets: Target[];
  basePath: string;
  issues: Issue[];
  /** Header values by target id and header name; kept apart from the configuration. */
  values: HeaderValues;
  onValues: (values: HeaderValues) => void;
  status: (url: string) => PermissionStatus;
  /** Called synchronously from the click so that the permission prompt keeps the user gesture. */
  onRequest: (url: string) => void;
  onChange: (targets: Target[]) => void;
}

export function TargetEditor({ targets, basePath, issues, values, onValues, status, onRequest, onChange }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [openId, setOpenId] = useState<string>();
  // The row whose open button gets the focus back when the details close.
  const returnTo = useRef<string | undefined>(undefined);
  const openIndex = targets.findIndex((x) => x.id === openId);
  const openTarget = targets[openIndex];
  const shownId = openTarget?.id;
  const nameOf = (x: Target) => x.name || t('options.targets.unnamed');

  const reorder = useReorder({
    sizeOf: () => targets.length,
    onMove: ({ from, to }) => onChange(moveTo(targets, from.index, to.index)),
    announce: ({ from, to }) => t('options.targets.moved', { name: nameOf(targets[from.index] as Target), position: to.index + 1, count: targets.length }),
  });

  // Runs after the dialog's own focus handling, since the effects of a parent come after those of its children.
  useEffect(() => {
    if (shownId !== undefined) {
      returnTo.current = shownId;
      document.getElementById(`${id}-details`)?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-focus]')?.focus();
      return;
    }
    const row = returnTo.current;
    if (row === undefined) return;
    returnTo.current = undefined;
    (document.getElementById(`${id}-open-${row}`) ?? document.getElementById(`${id}-add`))?.focus();
  }, [shownId, id]);

  const set = (i: number, next: Target) => onChange(targets.map((x, j) => (j === i ? next : x)));

  const add = () => {
    const target = newTarget(t('options.targets.newName'));
    onChange([...targets, target]);
    setOpenId(target.id);
  };

  const remove = (i: number) => {
    const target = targets[i];
    if (!target) return;
    // The focus goes to the row that takes the place of the removed one; without rows to the add button.
    returnTo.current = targets[i + 1]?.id ?? targets[i - 1]?.id ?? '';
    setOpenId(undefined);
    const { [target.id]: _gone, ...rest } = values;
    void _gone;
    onValues(rest);
    onChange(targets.filter((_, j) => j !== i));
  };

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, row: string) => {
    const control = e.target instanceof Element ? e.target.closest('button, a, input, select, textarea, [tabindex]') : null;
    if (control && e.currentTarget.contains(control)) return;
    setOpenId(row);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3>
        <span id={`${id}-title`}>{t('options.targets.title')}</span>{' '}
        <IconButton icon="info" label={t('ui.moreInfo')} tooltip={t('options.targets.hint')} className="q-help" />
      </h3>
      {targets.length === 0 ? (
        <EmptyState title={t('options.targets.empty')} />
      ) : (
        <DataTable
          caption={t('options.targets.title')}
          captionHidden
          columns={[
            { label: t('options.targets.table.order'), hidden: true, narrow: true },
            t('options.targets.name'),
            t('options.targets.url'),
            { label: t('options.targets.table.access'), narrow: true },
            { label: t('options.targets.table.actions'), hidden: true, narrow: true },
          ]}
        >
          {targets.map((target, i) => {
            const name = nameOf(target);
            const path = `${basePath}.targets[${i}]`;
            const invalid = target.name.trim() === '' || issues.some((x) => x.path === path || x.path.startsWith(`${path}.`));
            const granted = status(target.url) === 'granted';
            const { row: rowProps, grip } = reorder.item(target.id, name, i);
            return (
              <tr key={target.id} data-invalid={invalid || undefined} className={['options-field-row', rowProps.className].filter(Boolean).join(' ')} onClick={(e) => onRowClick(e, target.id)} onDragOver={rowProps.onDragOver} onDrop={rowProps.onDrop}>
                <td>
                  <IconButton {...grip} icon="grip-vertical" label={t('options.targets.grip', { name })} tooltip={t('options.targets.grip.help')} className="options-grip" />
                </td>
                <td className="options-field-name">
                  {name}
                  {invalid && (
                    <div>
                      <RowError>{t('options.targets.rowError')}</RowError>
                    </div>
                  )}
                </td>
                <td>
                  <Tooltip content={target.url}>
                    {(tip) => (
                      // Focusable so keyboard users reach the full address; it is shown as text only, never as markup.
                      <span tabIndex={0} className="options-address" {...tip}>
                        <span aria-hidden="true">{shortAddress(target.url)}</span>
                        <span className="q-sr-only">{target.url}</span>
                      </span>
                    )}
                  </Tooltip>
                </td>
                <td>
                  {originPattern(target.url) !== undefined && (
                    <span className={`options-perm options-perm--cell options-perm--${granted ? 'ok' : 'missing'}`} data-testid={`permission-${i}`}>
                      <Icon name={granted ? 'check' : 'alert'} />
                      {granted ? t('options.targets.permission.granted') : t('options.targets.permission.missing')}
                    </span>
                  )}
                </td>
                <td>
                  <RowActions>
                    <IconButton
                      id={`${id}-open-${target.id}`}
                      icon="chevron-right"
                      label={t('options.targets.open', { name })}
                      data-error-open={invalid || undefined}
                      onClick={() => setOpenId(target.id)}
                    />
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
      <p className="q-sr-only" role="status">
        {reorder.announcement}
      </p>
      {targets.length === 0 ? (
        <Button id={`${id}-add`} variant="primary" icon="plus" onClick={add}>
          {t('options.targets.add')}
        </Button>
      ) : (
        <IconButton id={`${id}-add`} icon="plus" label={t('options.targets.add')} onClick={add} />
      )}
      <DetailPanel
        open={openTarget !== undefined}
        onClose={() => setOpenId(undefined)}
        title={openTarget ? nameOf(openTarget) : ''}
        actions={
          openTarget && (
            <Button variant="danger" icon="trash" onClick={() => remove(openIndex)}>
              {t('options.targets.remove')}
            </Button>
          )
        }
      >
        {openTarget && (
          <div id={`${id}-details`}>
            <TargetDetails
              key={openTarget.id}
              target={openTarget}
              path={`${basePath}.targets[${openIndex}]`}
              issues={issues}
              values={values}
              onValues={onValues}
              status={status(openTarget.url)}
              canRequest={originPattern(openTarget.url) !== undefined}
              onRequest={() => onRequest(openTarget.url)}
              onChange={(next) => set(openIndex, next)}
            />
          </div>
        )}
      </DetailPanel>
    </section>
  );
}

interface DetailsProps {
  target: Target;
  path: string;
  issues: Issue[];
  values: HeaderValues;
  onValues: (values: HeaderValues) => void;
  status: PermissionStatus;
  canRequest: boolean;
  onRequest: () => void;
  onChange: (target: Target) => void;
}

function TargetDetails({ target, path, issues, values, onValues, status, canRequest, onRequest, onChange }: DetailsProps) {
  const { t } = useI18n();
  const [reveal, setReveal] = useState(false);
  const auth = accessKeyState(target, values);
  const own = values[target.id] ?? {};
  // The access key header is edited in the simple view; every other header is listed under "Advanced".
  const custom = target.headers.map((header, h) => ({ header, h })).filter(({ h }) => h !== auth.index || auth.custom);
  const headerErrors = issues.some((x) => x.path.startsWith(`${path}.headers[`));

  const setValue = (header: string, value: string) => onValues({ ...values, [target.id]: { ...own, [header]: value } });

  const renameHeader = (h: number, next: string) => {
    const old = target.headers[h];
    if (old === undefined) return;
    onChange({ ...target, headers: target.headers.map((x, k) => (k === h ? next : x)) });
    const v = own[old];
    // The value follows its header, unless the new name is already taken by another stored value.
    if (v !== undefined && old !== next && own[next] === undefined) {
      const { [old]: _gone, ...rest } = own;
      void _gone;
      onValues({ ...values, [target.id]: { ...rest, [next]: v } });
    }
  };

  const removeHeader = (h: number) => {
    const old = target.headers[h];
    if (old === undefined) return;
    onChange({ ...target, headers: target.headers.filter((_, k) => k !== h) });
    const { [old]: _gone, ...rest } = own;
    void _gone;
    onValues({ ...values, [target.id]: rest });
  };

  const urlError = errorsAt(issues, `${path}.url`)[0];

  return (
    <>
      <TextField
        label={t('options.targets.name')}
        value={target.name}
        error={target.name.trim() === '' ? t('options.targets.nameMissing') : errorsAt(issues, `${path}.name`)[0]}
        onChange={(e) => onChange({ ...target, name: e.target.value })}
      />
      <TextField
        label={t('options.targets.url')}
        hint={t('options.targets.url.hint')}
        help={t('options.targets.url.help')}
        type="url"
        value={target.url}
        error={urlError}
        onChange={(e) => onChange({ ...target, url: e.target.value })}
      />
      {canRequest && (
        <div role="status" className={`options-perm options-perm--${status === 'granted' ? 'ok' : 'missing'}`} data-testid="permission-detail">
          <Icon name={status === 'granted' ? 'check' : 'alert'} />
          <span>{status === 'granted' ? t('options.targets.permission.granted') : t('options.targets.permission.missing')}</span>
          {status !== 'granted' && (
            <Button onClick={onRequest}>{t('options.targets.permission.allow')}</Button>
          )}
        </div>
      )}
      <Disclosure defaultOpen={auth.key !== '' || target.headers.length > 0} forceOpen={headerErrors}>
      <TextField
        label={t('options.targets.key')}
        hint={auth.custom ? t('options.targets.key.custom') : t('options.targets.key.hint')}
        help={t('options.targets.key.help')}
        type={reveal ? 'text' : 'password'}
        autoComplete="off"
        disabled={auth.custom}
        value={auth.key}
        onChange={(e) => {
          const next = setAccessKey(target, values, e.target.value);
          onChange(next.target);
          onValues(next.values);
        }}
      />
      <Checkbox label={t('options.targets.key.show')} checked={reveal} disabled={auth.custom} onChange={(e) => setReveal(e.target.checked)} />
        <TextField label={t('options.targets.purpose')} value={target.purpose} onChange={(e) => onChange({ ...target, purpose: e.target.value })} />
        <fieldset className="options-headers">
          <legend>{t('options.targets.headers')}</legend>
          {custom.map(({ header, h }, n) => (
            <div key={h} role="group" aria-label={t('options.targets.header.group', { n: n + 1 })} className="options-header-row">
              <TextField
                label={t('options.targets.header.name')}
                value={header}
                error={errorsAt(issues, `${path}.headers[${h}]`)[0]}
                onChange={(e) => renameHeader(h, e.target.value)}
              />
              <TextField
                label={t('options.targets.header.value')}
                type="password"
                autoComplete="off"
                value={own[header] ?? ''}
                onChange={(e) => setValue(header, e.target.value)}
              />
              <Button icon="trash" onClick={() => removeHeader(h)}>
                {t('options.targets.header.remove')}
              </Button>
            </div>
          ))}
          <IconButton icon="plus" label={t('options.targets.header.add')} onClick={() => onChange({ ...target, headers: [...target.headers, ''] })} />
        </fieldset>
      </Disclosure>
    </>
  );
}
