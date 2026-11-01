import type { Field } from '../config';
import { errorsAt, moveItem, newField, type Issue } from './draft';
import { CheckboxInput, ItemButtons, SelectInput, TextInput } from './fields';

type Manual = NonNullable<Field['sources']['manual']>;

interface Props {
  fields: Field[];
  basePath: string;
  issues: Issue[];
  onChange: (fields: Field[]) => void;
  onRenameKey: (index: number, key: string) => void;
  onDelete: (index: number) => void;
}

export function FieldEditor({ fields, basePath, issues, onChange, onRenameKey, onDelete }: Props) {
  const set = (i: number, patch: Partial<Field>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setSources = (i: number, patch: Partial<Field['sources']>) => {
    const f = fields[i];
    if (f) set(i, { sources: { ...f.sources, ...patch } });
  };
  return (
    <section aria-labelledby="fields-h">
      <h3 id="fields-h">Fields</h3>
      <p className="hint">
        Sources are tried in this order: schema.org path, meta tag, site mapping, manual input. Leave a source empty to skip it.
      </p>
      {fields.map((f, i) => {
        const p = `${basePath}.fields[${i}]`;
        const manual = f.sources.manual;
        return (
          <fieldset key={i}>
            <legend>Field {i + 1}</legend>
            <TextInput label="Key" value={f.key} errors={errorsAt(issues, `${p}.key`)} onChange={(v) => onRenameKey(i, v)} />
            <TextInput label="Label" value={f.label} errors={errorsAt(issues, `${p}.label`)} onChange={(v) => set(i, { label: v })} />
            <CheckboxInput label="Required" checked={f.required} onChange={(v) => set(i, { required: v })} />
            <TextInput
              label="schema.org path"
              hint="Example: Article.author.name"
              value={f.sources.schemaOrgPath ?? ''}
              errors={errorsAt(issues, `${p}.sources.schemaOrgPath`)}
              onChange={(v) => setSources(i, { schemaOrgPath: v })}
            />
            <SelectInput
              label="Meta tag attribute"
              value={f.sources.metaTag?.attribute ?? 'name'}
              options={[
                ['name', 'name'],
                ['property', 'property'],
              ]}
              onChange={(v) => setSources(i, { metaTag: { attribute: v as 'name' | 'property', name: f.sources.metaTag?.name ?? '' } })}
            />
            <TextInput
              label="Meta tag name"
              hint="Example: description"
              value={f.sources.metaTag?.name ?? ''}
              errors={errorsAt(issues, `${p}.sources.metaTag.name`)}
              onChange={(v) => setSources(i, { metaTag: { attribute: f.sources.metaTag?.attribute ?? 'name', name: v } })}
            />
            <SelectInput
              label="Manual input"
              value={manual?.type ?? 'none'}
              options={[
                ['none', 'None'],
                ['text', 'Text'],
                ['choice', 'Choice list'],
              ]}
              onChange={(v) => {
                const next: Manual | undefined = v === 'text' ? { type: 'text' } : v === 'choice' ? { type: 'choice', values: [''] } : undefined;
                const sources = { ...f.sources };
                delete sources.manual;
                set(i, { sources: next ? { ...sources, manual: next } : sources });
              }}
            />
            {manual?.type === 'choice' && (
              <TextInput
                label="Choice values"
                hint="One value per line."
                multiline
                value={manual.values.join('\n')}
                errors={[...errorsAt(issues, `${p}.sources.manual.values`)]}
                onChange={(v) => setSources(i, { manual: { type: 'choice', values: v.split('\n') } })}
              />
            )}
            <ItemButtons
              noun="field"
              name={f.key || String(i + 1)}
              index={i}
              count={fields.length}
              onMove={(d) => onChange(moveItem(fields, i, d))}
              onDelete={() => onDelete(i)}
            />
          </fieldset>
        );
      })}
      <button type="button" onClick={() => onChange([...fields, newField(fields)])}>
        Add field
      </button>
    </section>
  );
}
