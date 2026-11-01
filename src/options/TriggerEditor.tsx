import type { Trigger } from '../config';
import { changeTriggerType, moveItem, newTrigger, type Issue, errorsAt } from './draft';
import { ItemButtons, SelectInput, TextInput } from './fields';

const TYPES: [Trigger['type'], string][] = [
  ['urlPrefix', 'URL prefix'],
  ['regex', 'Regular expression'],
  ['schemaOrgType', 'schema.org type'],
];

interface Props {
  triggers: Trigger[];
  basePath: string;
  issues: Issue[];
  onChange: (triggers: Trigger[]) => void;
}

export function TriggerEditor({ triggers, basePath, issues, onChange }: Props) {
  const set = (i: number, t: Trigger) => onChange(triggers.map((x, j) => (j === i ? t : x)));
  return (
    <section aria-labelledby="triggers-h">
      <h3 id="triggers-h">Triggers</h3>
      <p className="hint">The project matches a page if any of its triggers matches.</p>
      {triggers.map((t, i) => {
        const prop = t.type === 'regex' ? 'pattern' : 'value';
        const label = TYPES.find(([v]) => v === t.type)?.[1] ?? t.type;
        return (
          <fieldset key={i}>
            <legend>Trigger {i + 1}</legend>
            <SelectInput
              label="Trigger type"
              value={t.type}
              options={TYPES}
              onChange={(v) => set(i, changeTriggerType(v as Trigger['type']))}
            />
            <TextInput
              label={label}
              value={t.type === 'regex' ? t.pattern : t.value}
              errors={errorsAt(issues, `${basePath}.triggers[${i}].${prop}`)}
              onChange={(v) => set(i, t.type === 'regex' ? { type: 'regex', pattern: v } : { ...t, value: v })}
            />
            <ItemButtons
              noun="trigger"
              name={String(i + 1)}
              index={i}
              count={triggers.length}
              onMove={(d) => onChange(moveItem(triggers, i, d))}
              onDelete={() => onChange(triggers.filter((_, j) => j !== i))}
            />
          </fieldset>
        );
      })}
      <button type="button" onClick={() => onChange([...triggers, newTrigger()])}>
        Add trigger
      </button>
    </section>
  );
}
