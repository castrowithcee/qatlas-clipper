import { useId, useState } from 'react';
import type { HeaderValues, Target } from '../config';
import { useI18n } from '../settings';
import { Button, Checkbox, Disclosure, EmptyState, Icon, IconButton, TextField } from '../ui/components';
import { accessKeyState, setAccessKey } from './accessKey';
import { errorsAt, moveItem, newTarget, type Issue } from './draft';
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
  const set = (i: number, next: Target) => onChange(targets.map((x, j) => (j === i ? next : x)));

  const remove = (i: number) => {
    const target = targets[i];
    if (!target) return;
    const { [target.id]: _gone, ...rest } = values;
    void _gone;
    onValues(rest);
    onChange(targets.filter((_, j) => j !== i));
  };

  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3 id={`${id}-title`}>{t('options.targets.title')}</h3>
      <p className="q-hint">{t('options.targets.hint')}</p>
      {targets.length === 0 && <EmptyState title={t('options.targets.empty')} />}
      {targets.map((target, i) => (
        <TargetCard
          key={target.id}
          target={target}
          index={i}
          count={targets.length}
          path={`${basePath}.targets[${i}]`}
          issues={issues}
          values={values}
          onValues={onValues}
          status={status(target.url)}
          canRequest={originPattern(target.url) !== undefined}
          onRequest={() => onRequest(target.url)}
          onChange={(next) => set(i, next)}
          onMove={(d) => onChange(moveItem(targets, i, d))}
          onRemove={() => remove(i)}
        />
      ))}
      <Button icon="plus" onClick={() => onChange([...targets, newTarget(t('options.targets.newName'))])}>
        {t('options.targets.add')}
      </Button>
    </section>
  );
}

interface CardProps {
  target: Target;
  index: number;
  count: number;
  path: string;
  issues: Issue[];
  values: HeaderValues;
  onValues: (values: HeaderValues) => void;
  status: PermissionStatus;
  canRequest: boolean;
  onRequest: () => void;
  onChange: (target: Target) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

function TargetCard({ target, index, count, path, issues, values, onValues, status, canRequest, onRequest, onChange, onMove, onRemove }: CardProps) {
  const { t } = useI18n();
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const name = target.name || t('options.targets.unnamed');
  const auth = accessKeyState(target, values);
  const own = values[target.id] ?? {};
  // The access key header is edited in the simple view; every other header is listed under "Advanced".
  const custom = target.headers.map((header, h) => ({ header, h })).filter(({ h }) => h !== auth.index || auth.custom);
  const headerErrors = custom.some(({ h }) => errorsAt(issues, `${path}.headers[${h}]`).length > 0);

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
    <div role="group" aria-labelledby={`${id}-name`} className="options-field">
      <div className="options-field-head">
        <h4 id={`${id}-name`}>{name}</h4>
        <span className="options-field-actions">
          <IconButton icon="arrow-up" label={t('options.targets.moveUp', { name })} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton icon="arrow-down" label={t('options.targets.moveDown', { name })} disabled={index === count - 1} onClick={() => onMove(1)} />
        </span>
      </div>
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
        <div role="status" className={`options-perm options-perm--${status === 'granted' ? 'ok' : 'missing'}`} data-testid={`permission-${index}`}>
          <Icon name={status === 'granted' ? 'check' : 'alert'} />
          <span>{status === 'granted' ? t('options.targets.permission.granted') : t('options.targets.permission.missing')}</span>
          {status !== 'granted' && (
            <Button onClick={onRequest}>{t('options.targets.permission.allow')}</Button>
          )}
        </div>
      )}
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
      <Disclosure forceOpen={headerErrors}>
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
          <Button icon="plus" onClick={() => onChange({ ...target, headers: [...target.headers, ''] })}>
            {t('options.targets.header.add')}
          </Button>
        </fieldset>
      </Disclosure>
      <Button icon="trash" onClick={onRemove}>
        {t('options.targets.remove')}
      </Button>
    </div>
  );
}
