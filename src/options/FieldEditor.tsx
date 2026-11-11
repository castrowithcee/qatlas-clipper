import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { FIELD_FORMATS, fieldFormatOf, type Field, type FieldFormat, type Project } from '../config';
import { DETECT_VALUES } from '../extract/detect';
import { useI18n } from '../settings';
import type { MessageKey } from '../i18n';
import { Button, Checkbox, DataTable, DetailPanel, Disclosure, EmptyState, Icon, IconButton, RowActions, RowError, Select, TextField, Tooltip, type IconName } from '../ui/components';
import { ChoiceValues } from './ChoiceValues';
import { useReorder } from './reorder';
import { errorsAt, followIds, isValidFieldKey, mappedSites, moveTo, newField, newId, orphanMappings, setValueWay, valueWay, type Issue, type ValueWay } from './draft';

type Detect = (typeof DETECT_VALUES)[number];
type Translate = ReturnType<typeof useI18n>['t'];

interface Props {
  fields: Field[];
  siteMappings: Project['siteMappings'];
  basePath: string;
  issues: Issue[];
  onChange: (fields: Field[]) => void;
  onRenameKey: (index: number, key: string) => void;
  onDelete: (index: number) => void;
  onDeleteMapping: (site: string, key: string) => void;
}

const WAYS: ValueWay[] = ['detect', 'click', 'manual'];

// Row ids chosen for a field before it reaches the list, so that its details can open in the same step.
const presetIds = new WeakMap<Field, string>();
const freshId = (field: Field): string => presetIds.get(field) ?? newId();

/** Fields have no id and an editable key; the rows get ids of their own that follow each field through edits and moves. */
function useRowIds(fields: Field[]): string[] {
  const [rows, setRows] = useState(() => ({ fields, ids: fields.map(freshId) }));
  if (rows.fields === fields) return rows.ids;
  const next = { fields, ids: followIds(rows.fields, rows.ids, fields, freshId) };
  setRows(next);
  return next.ids;
}

interface FieldErrors {
  label?: string;
  key?: string;
  schema?: string;
  meta?: string;
  values?: string;
  /** Per website with a mapping of this field. */
  sites: Record<string, string>;
}

function fieldErrors(t: Translate, fields: Field[], index: number, basePath: string, issues: Issue[], sites: string[]): FieldErrors {
  const field = fields[index] as Field;
  const path = `${basePath}.fields[${index}]`;
  const manual = field.sources.manual;
  const mapped: Record<string, string> = {};
  for (const site of sites) {
    const errors = errorsAt(issues, `${basePath}.siteMappings.${site}.${field.key}`);
    if (errors.length > 0) mapped[site] = errors.join('; ');
  }
  return {
    label: field.label.trim() === '' ? t('options.fields.labelMissing') : errorsAt(issues, `${path}.label`)[0],
    key: !isValidFieldKey(field.key)
      ? t('options.fields.key.invalid')
      : fields.some((f, j) => j < index && f.key === field.key)
        ? t('options.fields.key.duplicate')
        : errorsAt(issues, `${path}.key`)[0],
    schema: errorsAt(issues, `${path}.sources.schemaOrgPath`)[0],
    meta: errorsAt(issues, `${path}.sources.metaTag.name`)[0],
    values:
      manual?.type === 'choice'
        ? manual.values.length === 0
          ? t('options.fields.values.missing')
          : issues.find((i) => i.path === `${path}.sources.manual.values` || i.path.startsWith(`${path}.sources.manual.values[`))?.message
        : undefined,
    sites: mapped,
  };
}

const hasErrors = (e: FieldErrors): boolean => Boolean(e.label || e.key || e.schema || e.meta || e.values || Object.keys(e.sites).length > 0);

/** Where the value comes from, with the icons and words of the popup. */
function sourceOf(field: Field, t: Translate): { icon: IconName; text: string } {
  const way = valueWay(field);
  if (way === 'click') return { icon: 'click-mapped', text: t('popup.source.click') };
  if (way === 'manual') return { icon: 'pencil', text: t('popup.source.manual') };
  return { icon: 'auto', text: t('popup.source.detect', { value: t(`popup.detect.${field.sources.detect}` as MessageKey) }) };
}

export function FieldEditor({ fields, siteMappings, basePath, issues, onChange, onRenameKey, onDelete, onDeleteMapping }: Props) {
  const { t } = useI18n();
  const id = useId();
  const ids = useRowIds(fields);
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  // The row whose open button gets the focus back when the details close.
  const returnTo = useRef<string | undefined>(undefined);

  const openIndex = openId === undefined ? -1 : ids.indexOf(openId);
  const openField = fields[openIndex];
  const shownId = openField ? openId : undefined;
  const nameOf = (f: Field) => f.label || t('options.fields.unnamed');

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
    (document.getElementById(`${id}-open-${row}`) ?? document.getElementById(`${id}-title`)?.closest('section')?.querySelector<HTMLElement>('.options-add input'))?.focus();
  }, [shownId, id]);

  const add = () => {
    if (label.trim() === '') {
      setLabelError(t('options.fields.labelMissing'));
      return;
    }
    const field = newField(fields, label);
    const row = newId();
    presetIds.set(field, row);
    onChange([...fields, field]);
    setOpenId(row);
    setLabel('');
    setLabelError(undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  const reorder = useReorder({
    sizeOf: () => fields.length,
    onMove: ({ from, to }) => onChange(moveTo(fields, from.index, to.index)),
    announce: ({ from, to }) => t('options.fields.moved', { name: nameOf(fields[from.index] as Field), position: to.index + 1, count: fields.length }),
  });

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, row: string) => {
    const control = e.target instanceof Element ? e.target.closest('button, a, input, select, textarea, [tabindex]') : null;
    if (control && e.currentTarget.contains(control)) return;
    setOpenId(row);
  };

  const remove = (index: number) => {
    // The focus goes to the row that takes the place of the deleted one; without rows to the input for a new field.
    returnTo.current = ids[index + 1] ?? ids[index - 1] ?? '';
    setOpenId(undefined);
    onDelete(index);
  };

  const orphans = orphanMappings({ fields, siteMappings });
  const openSites = openField ? mappedSites({ siteMappings }, openField.key) : [];

  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3>
        <span id={`${id}-title`}>{t('options.fields.title')}</span>{' '}
        <IconButton icon="info" label={t('ui.moreInfo')} tooltip={t('options.fields.hint')} className="q-help" />
      </h3>
      {fields.length === 0 ? (
        <EmptyState title={t('options.fields.empty')} />
      ) : (
        <DataTable
          caption={t('options.fields.title')}
          captionHidden
          columns={[
            { label: t('options.fields.table.order'), hidden: true, narrow: true },
            t('options.fields.label'),
            { label: t('options.fields.table.source'), narrow: true },
            { label: t('options.fields.format.label'), narrow: true },
            { label: t('options.fields.required'), narrow: true },
            { label: t('options.fields.table.sites'), narrow: true },
            { label: t('options.fields.table.actions'), hidden: true, narrow: true },
          ]}
        >
          {fields.map((f, i) => {
            const row = ids[i] as string;
            const name = nameOf(f);
            const sites = mappedSites({ siteMappings }, f.key);
            const invalid = hasErrors(fieldErrors(t, fields, i, basePath, issues, sites.map(([s]) => s)));
            const source = sourceOf(f, t);
            const { row: rowProps, grip } = reorder.item(row, name, i);
            return (
              <tr
                key={row}
                data-invalid={invalid || undefined}
                className={['options-field-row', rowProps.className].filter(Boolean).join(' ')}
                onClick={(e) => onRowClick(e, row)}
                onDragOver={rowProps.onDragOver}
                onDrop={rowProps.onDrop}
              >
                <td>
                  <IconButton
                    {...grip}
                    icon="grip-vertical"
                    label={t('options.fields.grip', { name })}
                    tooltip={t('options.fields.grip.help')}
                    className="options-grip"
                  />
                </td>
                <td className="options-field-name">
                  {name}
                  {invalid && (
                    <div>
                      <RowError>{t('options.fields.rowError')}</RowError>
                    </div>
                  )}
                </td>
                <td>
                  <Tooltip content={source.text}>
                    {(tip) => (
                      // Focusable so keyboard users reach the tooltip; the label carries the same text.
                      <span role="img" aria-label={source.text} tabIndex={0} className="options-source" {...tip}>
                        <Icon name={source.icon} />
                      </span>
                    )}
                  </Tooltip>
                </td>
                {/* Typed-in values have no format; they are sent as entered, like text. */}
                <td>{t(`options.fields.format.${valueWay(f) === 'manual' ? 'text' : fieldFormatOf(f, valueWay(f) === 'click')}` as MessageKey)}</td>
                <td>{f.required ? t('options.fields.yes') : t('options.fields.no')}</td>
                <td>{sites.length}</td>
                <td>
                  <RowActions>
                    <IconButton
                      id={`${id}-open-${row}`}
                      icon="chevron-right"
                      label={t('options.fields.open', { name })}
                      data-error-open={invalid || undefined}
                      onClick={() => setOpenId(row)}
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
      {orphans.length > 0 && (
        <ul className="options-orphans">
          {orphans.map(({ site, key }) => (
            <li key={`${site}\u0000${key}`}>
              <Icon name="alert" className="options-orphan-icon" />
              <span>{t('options.mappings.orphan', { site, key })}</span>
              <Button variant="danger" aria-label={t('options.mappings.orphanDelete', { site, key })} data-error-focus onClick={() => onDeleteMapping(site, key)}>
                {t('options.mappings.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
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
        {fields.length === 0 ? (
          <Button variant="primary" icon="plus" onClick={add}>
            {t('options.fields.add.button')}
          </Button>
        ) : (
          <IconButton icon="plus" label={t('options.fields.add.button')} onClick={add} />
        )}
      </div>
      <DetailPanel
        open={openField !== undefined}
        onClose={() => setOpenId(undefined)}
        title={openField ? nameOf(openField) : ''}
        actions={
          openField && (
            <Button variant="danger" icon="trash" aria-label={t('options.fields.delete', { name: nameOf(openField) })} onClick={() => remove(openIndex)}>
              {t('options.fields.deleteButton')}
            </Button>
          )
        }
      >
        {openField && (
          <div id={`${id}-details`}>
            <FieldDetails
              field={openField}
              errors={fieldErrors(t, fields, openIndex, basePath, issues, openSites.map(([s]) => s))}
              sites={openSites}
              onChange={(next) => onChange(fields.map((x, j) => (j === openIndex ? next : x)))}
              onRenameKey={(key) => onRenameKey(openIndex, key)}
              onDeleteMapping={(site) => onDeleteMapping(site, openField.key)}
            />
          </div>
        )}
      </DetailPanel>
    </section>
  );
}

interface DetailsProps {
  field: Field;
  errors: FieldErrors;
  sites: [site: string, selector: string][];
  onChange: (field: Field) => void;
  onRenameKey: (key: string) => void;
  onDeleteMapping: (site: string) => void;
}

function FieldDetails({ field, errors, sites, onChange, onRenameKey, onDeleteMapping }: DetailsProps) {
  const { t } = useI18n();
  const id = useId();
  const way = valueWay(field);
  const { sources } = field;
  const setSources = (patch: Partial<Field['sources']>) => onChange({ ...field, sources: { ...sources, ...patch } });
  const manual = sources.manual;

  return (
    <>
      <TextField label={t('options.fields.label')} value={field.label} error={errors.label} onChange={(e) => onChange({ ...field, label: e.target.value })} />
      <Checkbox label={t('options.fields.required')} checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} />
      <Select
        label={t('options.fields.way.label')}
        help={t('options.fields.way.help')}
        value={way}
        options={WAYS.map((w) => ({ value: w, label: t(`options.fields.way.${w}` as MessageKey) }))}
        onChange={(e) => onChange(setValueWay(field, e.target.value as ValueWay))}
      />
      {way !== 'manual' && (
        <Select
          label={t('options.fields.format.label')}
          help={t('options.fields.format.help')}
          value={fieldFormatOf(field, way === 'click')}
          options={FIELD_FORMATS.map((f) => ({ value: f, label: t(`options.fields.format.${f}` as MessageKey) }))}
          onChange={(e) => onChange({ ...field, format: e.target.value as FieldFormat })}
        />
      )}
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
            <ChoiceValues values={manual.values} error={errors.values} onChange={(values) => setSources({ manual: { type: 'choice', values } })} />
          )}
        </>
      )}
      <Disclosure forceOpen={Boolean(errors.key || errors.schema || errors.meta)}>
        <TextField label={t('options.fields.key.label')} hint={t('options.fields.key.hint')} error={errors.key} value={field.key} onChange={(e) => onRenameKey(e.target.value)} />
        <TextField
          label={t('options.fields.schema.label')}
          hint={t('options.fields.schema.hint')}
          error={errors.schema}
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
          error={errors.meta}
          value={sources.metaTag?.name ?? ''}
          onChange={(e) => setSources({ metaTag: { attribute: sources.metaTag?.attribute ?? 'name', name: e.target.value } })}
        />
      </Disclosure>
      <section aria-labelledby={`${id}-mappings`} className="options-mappings">
        <h3 id={`${id}-mappings`}>{t('options.mappings.title')}</h3>
        <p className="q-hint">{sites.length === 0 ? t('options.mappings.empty') : t('options.mappings.hint')}</p>
        {sites.length > 0 && (
          <ul className="options-mapping-list">
            {sites.map(([site, selector]) => {
              const error = errors.sites[site];
              return (
                <li key={site}>
                  <span className="options-mapping-label">{site}</span>
                  <IconButton icon="info" label={t('options.mappings.show', { site })} tooltip={selector} className="q-help" />
                  <Button variant="danger" aria-label={t('options.mappings.delete', { site })} data-error-focus={error ? true : undefined} onClick={() => onDeleteMapping(site)}>
                    {t('options.mappings.remove')}
                  </Button>
                  {error && <span className="q-error">{error}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
