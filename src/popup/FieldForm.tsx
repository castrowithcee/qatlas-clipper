import { fieldFormatOf, type Field as FieldConfig, type FieldFormat } from '../config';
import { valueWay } from '../options/draft';
import { AddFieldRow } from './AddFieldRow';
import { LongValue } from './LongValue';
import type { FieldResult } from '../extract';
import type { IconName } from '../ui/components';
import { Field, Icon, IconButton, Menu, Tooltip, type MenuEntry } from '../ui/components';
import { useI18n } from '../settings';
import type { MessageKey, Translator } from '../i18n';

export interface SourceInfo {
  icon: IconName;
  text: string;
}

/**
 * Where a shown value comes from, in plain words. A user edit or a missing read value counts as "enter it yourself";
 * a detect value is named, own schema paths and meta tags are only "detected automatically".
 */
export function sourceInfo(field: FieldConfig, found: FieldResult | undefined, edited: boolean, i18n: Pick<Translator, 't'>): SourceInfo {
  const { t } = i18n;
  if (edited || !found || found.source === 'manual') return { icon: 'edit', text: t('popup.source.manual') };
  if (found.source === 'selector') return { icon: 'pointer', text: t('popup.source.click') };
  if (found.source === 'detect' && field.sources.detect) {
    return { icon: 'auto', text: t('popup.source.detect', { value: t(`popup.detect.${field.sources.detect}` as MessageKey) }) };
  }
  return { icon: 'auto', text: t('popup.source.auto') };
}

function SourceMark({ icon, text }: SourceInfo) {
  return (
    <Tooltip content={text}>
      {(tip) => (
        // Focusable so keyboard users reach the tooltip; the label carries the same text.
        <span role="img" aria-label={text} tabIndex={0} className="popup-source" {...tip}>
          <Icon name={icon} />
        </span>
      )}
    </Tooltip>
  );
}

interface RowProps {
  field: FieldConfig;
  value: string;
  source: SourceInfo;
  invalid: boolean;
  onChange: (v: string) => void;
  onPick: () => void;
  /** Whether a click mapping of this field exists for the current site. */
  mapped: boolean;
  onUpdate?: (patch: FieldPatch) => void;
  onRemoveMapping?: () => void;
}

/** What the field menu can change. */
export type FieldPatch = { required: boolean } | { format: FieldFormat };

function FieldRow({ field, value, source, invalid, onChange, onPick, mapped, onUpdate, onRemoveMapping }: RowProps) {
  const { t } = useI18n();
  const entries: MenuEntry[] = [{ kind: 'action', label: t('popup.menu.repick'), onSelect: onPick }];
  if (mapped && onRemoveMapping) entries.push({ kind: 'action', label: t('popup.menu.unmap'), onSelect: onRemoveMapping });
  if (onUpdate) {
    entries.push({ kind: 'checkbox', label: t('popup.menu.required'), checked: field.required, onSelect: () => onUpdate({ required: !field.required }) });
    // The format only applies to values read from a clicked element.
    if (valueWay(field) === 'click') {
      for (const format of ['text', 'markdown'] as const) {
        entries.push({
          kind: 'radio',
          group: t('popup.menu.format'),
          label: t(format === 'text' ? 'popup.menu.formatText' : 'popup.menu.formatMarkdown'),
          checked: fieldFormatOf(field, true) === format,
          onSelect: () => onUpdate({ format }),
        });
      }
    }
  }
  const choice = field.sources.manual?.type === 'choice' ? field.sources.manual.values : null;
  return (
    <Field
      label={field.required ? t('popup.field.required', { label: field.label }) : field.label}
      error={invalid ? t('popup.field.missing') : undefined}
    >
      {(control) => (
        <div className="popup-control">
          {choice ? (
            <select {...control} className="q-input q-select" value={value} required={field.required} onChange={(e) => onChange(e.target.value)}>
              <option value="">—</option>
              {value !== '' && !choice.includes(value) && <option value={value}>{value}</option>}
              {choice.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            // Multi-line so line breaks of clicked areas survive viewing, editing and sending.
            <LongValue
              control={{ ...control, required: field.required }}
              label={field.label}
              value={value}
              onChange={onChange}
              markdown={valueWay(field) === 'click' && fieldFormatOf(field, true) === 'markdown'}
            />
          )}
          <SourceMark {...source} />
          <Tooltip content={t('popup.field.pickTip')}>
            {(tip) => <IconButton icon="pointer" label={t('popup.field.pick', { label: field.label })} onClick={onPick} {...tip} />}
          </Tooltip>
          <Tooltip content={t('popup.menu.tip')}>
            {(tip) => <Menu label={t('popup.menu.button', { label: field.label })} entries={entries} buttonProps={tip} />}
          </Tooltip>
        </div>
      )}
    </Field>
  );
}

interface FormProps {
  fields: FieldConfig[];
  /** Fields as read from the page for the chosen project. */
  found: Record<string, FieldResult>;
  /** User edits for the chosen project. */
  edits: Record<string, string>;
  invalidKeys: string[];
  note: string;
  onChange: (key: string, value: string) => void;
  onNote: (note: string) => void;
  onPick: (field: FieldConfig) => void;
  /** Adds a field and starts picking it; rejects when saving failed. */
  onAddField?: (label: string) => Promise<void>;
  /** Keys of fields with a click mapping for the current site. */
  mappedKeys?: string[];
  /** Field menu: saves immediately. Without it the menu offers only picking and removing a mapping. */
  onUpdateField?: (field: FieldConfig, patch: FieldPatch) => void;
  onRemoveMapping?: (field: FieldConfig) => void;
}

export function FieldForm({ fields, found, edits, invalidKeys, note, onChange, onNote, onPick, onAddField, mappedKeys = [], onUpdateField, onRemoveMapping }: FormProps) {
  const i18n = useI18n();
  return (
    <form className="popup-form" onSubmit={(e) => e.preventDefault()}>
      {fields.map((field) => {
        const edited = edits[field.key];
        const read = found[field.key];
        return (
          <FieldRow
            key={field.key}
            field={field}
            value={edited ?? read?.value ?? ''}
            source={sourceInfo(field, read, edited !== undefined, i18n)}
            invalid={invalidKeys.includes(field.key)}
            onChange={(v) => onChange(field.key, v)}
            onPick={() => onPick(field)}
            mapped={mappedKeys.includes(field.key)}
            onUpdate={onUpdateField && ((patch) => onUpdateField(field, patch))}
            onRemoveMapping={onRemoveMapping && (() => onRemoveMapping(field))}
          />
        );
      })}
      {onAddField && <AddFieldRow onAdd={onAddField} />}
      <Field label={i18n.t('popup.note.label')}>
        {(control) => <textarea {...control} className="q-input" rows={3} value={note} onChange={(e) => onNote(e.target.value)} />}
      </Field>
    </form>
  );
}
