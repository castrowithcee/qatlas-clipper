import { useId, useState, type KeyboardEvent } from 'react';
import type { Field } from '../config';
import { DETECT_VALUES } from '../extract/detect';
import { useI18n } from '../settings';
import type { MessageKey } from '../i18n';
import { Button, Checkbox, Disclosure, EmptyState, IconButton, Select, TextField } from '../ui/components';
import { ChoiceValues } from './ChoiceValues';
import { errorsAt, isValidFieldKey, moveItem, newField, setValueWay, valueWay, type Issue, type ValueWay } from './draft';

type Detect = (typeof DETECT_VALUES)[number];

interface Props {
  fields: Field[];
  basePath: string;
  issues: Issue[];
  onChange: (fields: Field[]) => void;
  onRenameKey: (index: number, key: string) => void;
  onDelete: (index: number) => void;
}

const WAYS: ValueWay[] = ['detect', 'click', 'manual'];

export function FieldEditor({ fields, basePath, issues, onChange, onRenameKey, onDelete }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string>();

  const add = () => {
    if (label.trim() === '') {
      setLabelError(t('options.fields.labelMissing'));
      return;
    }
    onChange([...fields, newField(fields, label)]);
    setLabel('');
    setLabelError(undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3 id={`${id}-title`}>{t('options.fields.title')}</h3>
      <p className="q-hint">{t('options.fields.hint')}</p>
      {fields.length === 0 && <EmptyState title={t('options.fields.empty')} />}
      {fields.map((f, i) => (
        <FieldCard
          key={i}
          field={f}
          fields={fields}
          index={i}
          path={`${basePath}.fields[${i}]`}
          issues={issues}
          onChange={(next) => onChange(fields.map((x, j) => (j === i ? next : x)))}
          onRenameKey={(key) => onRenameKey(i, key)}
          onMove={(d) => onChange(moveItem(fields, i, d))}
          onDelete={() => onDelete(i)}
        />
      ))}
      <div className="options-add">
        <TextField
          label={t('options.fields.add.label')}
          error={labelError}
          value={label}
          autoComplete="off"
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelError(undefined);
          }}
          onKeyDown={onKeyDown}
        />
        <Button icon="plus" onClick={add}>
          {t('options.fields.add.button')}
        </Button>
      </div>
    </section>
  );
}

interface CardProps {
  field: Field;
  fields: Field[];
  index: number;
  path: string;
  issues: Issue[];
  onChange: (field: Field) => void;
  onRenameKey: (key: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

function FieldCard({ field, fields, index, path, issues, onChange, onRenameKey, onMove, onDelete }: CardProps) {
  const { t } = useI18n();
  const id = useId();
  const way = valueWay(field);
  const name = field.label || t('options.fields.unnamed');
  const { sources } = field;
  const setSources = (patch: Partial<Field['sources']>) => onChange({ ...field, sources: { ...sources, ...patch } });

  const labelError = field.label.trim() === '' ? t('options.fields.labelMissing') : errorsAt(issues, `${path}.label`)[0];
  const keyError = !isValidFieldKey(field.key)
    ? t('options.fields.key.invalid')
    : fields.some((f, j) => j < index && f.key === field.key)
      ? t('options.fields.key.duplicate')
      : errorsAt(issues, `${path}.key`)[0];
  const schemaError = errorsAt(issues, `${path}.sources.schemaOrgPath`)[0];
  const metaError = errorsAt(issues, `${path}.sources.metaTag.name`)[0];
  const manual = sources.manual;
  const valuesError =
    manual?.type === 'choice' ? (manual.values.length === 0 ? t('options.fields.values.missing') : errorsAt(issues, `${path}.sources.manual.values`)[0]) : undefined;

  return (
    <div role="group" aria-labelledby={`${id}-name`} className="options-field">
      <div className="options-field-head">
        <h4 id={`${id}-name`}>{name}</h4>
        <span className="options-field-actions">
          <IconButton icon="arrow-up" label={t('options.fields.moveUp', { name })} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton icon="arrow-down" label={t('options.fields.moveDown', { name })} disabled={index === fields.length - 1} onClick={() => onMove(1)} />
          <IconButton icon="trash" label={t('options.fields.delete', { name })} onClick={onDelete} />
        </span>
      </div>
      <TextField label={t('options.fields.label')} value={field.label} error={labelError} onChange={(e) => onChange({ ...field, label: e.target.value })} />
      <Checkbox label={t('options.fields.required')} checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} />
      <Select
        label={t('options.fields.way.label')}
        help={t('options.fields.way.help')}
        value={way}
        options={WAYS.map((w) => ({ value: w, label: t(`options.fields.way.${w}` as MessageKey) }))}
        onChange={(e) => onChange(setValueWay(field, e.target.value as ValueWay))}
      />
      {way === 'detect' && (
        <Select
          label={t('options.fields.detect.label')}
          value={sources.detect ?? 'title'}
          options={DETECT_VALUES.map((v) => ({ value: v, label: t(`popup.detect.${v}` as MessageKey) }))}
          onChange={(e) => setSources({ detect: e.target.value as Detect })}
        />
      )}
      {way === 'manual' && (
        <>
          <Select
            label={t('options.fields.input.label')}
            value={manual?.type ?? 'text'}
            options={[
              { value: 'text', label: t('options.fields.input.text') },
              { value: 'choice', label: t('options.fields.input.choice') },
            ]}
            onChange={(e) => setSources({ manual: e.target.value === 'choice' ? { type: 'choice', values: [] } : { type: 'text' } })}
          />
          {manual?.type === 'choice' && (
            <ChoiceValues values={manual.values} error={valuesError} onChange={(values) => setSources({ manual: { type: 'choice', values } })} />
          )}
        </>
      )}
      <Disclosure forceOpen={Boolean(keyError || schemaError || metaError)}>
        <TextField label={t('options.fields.key.label')} hint={t('options.fields.key.hint')} error={keyError} value={field.key} onChange={(e) => onRenameKey(e.target.value)} />
        <TextField
          label={t('options.fields.schema.label')}
          hint={t('options.fields.schema.hint')}
          error={schemaError}
          value={sources.schemaOrgPath ?? ''}
          onChange={(e) => setSources({ schemaOrgPath: e.target.value })}
        />
        <Select
          label={t('options.fields.meta.attribute')}
          value={sources.metaTag?.attribute ?? 'name'}
          options={[
            { value: 'name', label: 'name' },
            { value: 'property', label: 'property' },
          ]}
          onChange={(e) => setSources({ metaTag: { attribute: e.target.value as 'name' | 'property', name: sources.metaTag?.name ?? '' } })}
        />
        <TextField
          label={t('options.fields.meta.name')}
          hint={t('options.fields.meta.hint')}
          error={metaError}
          value={sources.metaTag?.name ?? ''}
          onChange={(e) => setSources({ metaTag: { attribute: sources.metaTag?.attribute ?? 'name', name: e.target.value } })}
        />
      </Disclosure>
    </div>
  );
}
