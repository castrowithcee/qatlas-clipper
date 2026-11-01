import type { HeaderValues, Target } from '../config';
import { errorsAt, moveItem, newTarget, type Issue } from './draft';
import { ItemButtons, TextInput } from './fields';
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

const STATUS_TEXT: Record<PermissionStatus, string> = {
  granted: 'granted',
  denied: 'denied',
  unchecked: 'not requested yet',
};

export function TargetEditor({ targets, basePath, issues, values, onValues, status, onRequest, onChange }: Props) {
  const set = (i: number, patch: Partial<Target>) => onChange(targets.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setValue = (id: string, name: string, value: string) => onValues({ ...values, [id]: { ...values[id], [name]: value } });
  const withoutValue = (id: string, name: string): HeaderValues => {
    const { [name]: _gone, ...rest } = values[id] ?? {};
    void _gone;
    return { ...values, [id]: rest };
  };

  const renameHeader = (i: number, h: number, name: string) => {
    const t = targets[i];
    const old = t?.headers[h];
    if (!t || old === undefined) return;
    set(i, { headers: t.headers.map((x, k) => (k === h ? name : x)) });
    const v = values[t.id]?.[old];
    // The value follows its header, unless the new name is already taken by another stored value.
    if (v !== undefined && old !== name && values[t.id]?.[name] === undefined) {
      const moved = withoutValue(t.id, old);
      onValues({ ...moved, [t.id]: { ...moved[t.id], [name]: v } });
    }
  };

  const removeHeader = (i: number, h: number) => {
    const t = targets[i];
    const name = t?.headers[h];
    if (!t || name === undefined) return;
    set(i, { headers: t.headers.filter((_, k) => k !== h) });
    onValues(withoutValue(t.id, name));
  };

  const removeTarget = (i: number) => {
    const t = targets[i];
    if (!t) return;
    const { [t.id]: _gone, ...rest } = values;
    void _gone;
    onValues(rest);
    onChange(targets.filter((_, j) => j !== i));
  };

  return (
    <section aria-labelledby="targets-h">
      <h3 id="targets-h">Targets</h3>
      <p className="hint">
        Webhooks that receive the captured data. Only https: URLs are allowed, http: only for localhost. Header values are stored
        separately on this device and are never exported.
      </p>
      {targets.length === 0 && <p>No targets.</p>}
      {targets.map((t, i) => {
        const p = `${basePath}.targets[${i}]`;
        const st = status(t.url);
        const canRequest = originPattern(t.url) !== undefined;
        return (
          <fieldset key={t.id}>
            <legend>Target {i + 1}</legend>
            <TextInput label="Target name" value={t.name} errors={errorsAt(issues, `${p}.name`)} onChange={(v) => set(i, { name: v })} />
            <TextInput label="Target URL" hint="Example: https://example.com/hook" value={t.url} errors={errorsAt(issues, `${p}.url`)} onChange={(v) => set(i, { url: v })} />
            <TextInput label="Target purpose" value={t.purpose} onChange={(v) => set(i, { purpose: v })} />
            <p>
              <span data-testid={`permission-${i}`}>Permission for this address: {STATUS_TEXT[st]}</span>{' '}
              {canRequest && st !== 'granted' && (
                <button type="button" aria-label={`Request permission for target ${t.name || i + 1}`} onClick={() => onRequest(t.url)}>
                  {st === 'denied' ? 'Request again' : 'Request permission'}
                </button>
              )}
            </p>
            {t.headers.map((name, h) => (
              <div key={h} role="group" aria-label={`Header ${h + 1} of target ${i + 1}`}>
                <TextInput label={`Header name ${h + 1}`} value={name} errors={errorsAt(issues, `${p}.headers[${h}]`)} onChange={(v) => renameHeader(i, h, v)} />
                <TextInput
                  label={`Header value ${h + 1}`}
                  type="password"
                  value={values[t.id]?.[name] ?? ''}
                  onChange={(v) => setValue(t.id, name, v)}
                />
                <button type="button" aria-label={`Remove header ${h + 1} of target ${i + 1}`} onClick={() => removeHeader(i, h)}>
                  Remove header
                </button>
              </div>
            ))}
            <button type="button" aria-label={`Add header to target ${i + 1}`} onClick={() => set(i, { headers: [...t.headers, ''] })}>
              Add header
            </button>
            <ItemButtons
              noun="target"
              name={t.name || String(i + 1)}
              index={i}
              count={targets.length}
              onMove={(d) => onChange(moveItem(targets, i, d))}
              onDelete={() => removeTarget(i)}
            />
          </fieldset>
        );
      })}
      <button type="button" onClick={() => onChange([...targets, newTarget()])}>
        Add target
      </button>
    </section>
  );
}
