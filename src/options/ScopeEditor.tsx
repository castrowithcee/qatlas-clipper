import { useId, useState, type KeyboardEvent } from 'react';
import type { Scope } from '../config';
import { PAGE_KINDS, type PageKind } from '../extract';
import { useI18n } from '../settings';
import type { MessageKey } from '../i18n';
import { Button, Chip, Disclosure, Select, TextField } from '../ui/components';
import { errorsAt, parseWebsite, setAllSites, setPageKind, type Issue } from './draft';

interface Props {
  scope: Scope;
  basePath: string;
  issues: Issue[];
  onChange: (scope: Scope) => void;
}

const KIND_LABEL: Record<PageKind, MessageKey> = {
  product: 'options.scope.kind.product',
  jobPosting: 'options.scope.kind.jobPosting',
  article: 'options.scope.kind.article',
  event: 'options.scope.kind.event',
  recipe: 'options.scope.kind.recipe',
  localBusiness: 'options.scope.kind.localBusiness',
};

export function ScopeEditor({ scope, basePath, issues, onChange }: Props) {
  const { t } = useI18n();
  const id = useId();
  const path = `${basePath}.scope`;
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string>();

  // Returns whether the entry was accepted; an empty input is not an error.
  const add = (): boolean => {
    if (input.trim() === '') {
      setInputError(undefined);
      return true;
    }
    const site = parseWebsite(input);
    if (!site) {
      setInputError(t('options.scope.siteInvalid'));
      return false;
    }
    if (scope.domains.includes(site)) {
      setInputError(t('options.scope.siteDuplicate'));
      return false;
    }
    onChange({ ...scope, domains: [...scope.domains, site] });
    setInput('');
    setInputError(undefined);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  // Domains reach the draft only through the input above, so the one reachable problem is an empty list.
  const listError =
    !scope.allSites && scope.domains.length === 0 ? t('options.scope.siteMissing') : errorsAt(issues, `${path}.domains`)[0];

  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3 id={`${id}-title`}>{t('options.scope.title')}</h3>
      <div role="radiogroup" aria-labelledby={`${id}-title`} className="options-choice">
        <label>
          <input type="radio" name={`${id}-all`} checked={scope.allSites} onChange={() => onChange(setAllSites(scope, true))} />
          {t('options.scope.all')}
        </label>
        <label>
          <input type="radio" name={`${id}-all`} checked={!scope.allSites} onChange={() => onChange(setAllSites(scope, false))} />
          {t('options.scope.sites')}
        </label>
      </div>
      {!scope.allSites && (
        <div className="options-sites">
          {scope.domains.length > 0 && (
            <ul className="options-chips" aria-label={t('options.scope.siteList')}>
              {scope.domains.map((d, i) => (
                <Chip
                  key={d}
                  label={d}
                  removeLabel={t('options.scope.siteRemove', { site: d })}
                  onRemove={() => onChange({ ...scope, domains: scope.domains.filter((_, j) => j !== i) })}
                />
              ))}
            </ul>
          )}
          <div className="options-add">
            <TextField
              label={t('options.scope.siteLabel')}
              hint={t('options.scope.siteHint')}
              error={inputError ?? (input === '' ? listError : undefined)}
              value={input}
              inputMode="url"
              autoComplete="off"
              onChange={(e) => {
                setInput(e.target.value);
                setInputError(undefined);
              }}
              onKeyDown={onKeyDown}
              onBlur={add}
            />
            <Button icon="plus" onClick={add}>
              {t('options.scope.siteAdd')}
            </Button>
          </div>
        </div>
      )}
      <Disclosure defaultOpen={Boolean(scope.pageKind || scope.pageType)} forceOpen={errorsAt(issues, `${path}.pageType`).length > 0}>
      <Select
        label={t('options.scope.kind.label')}
        hint={t('options.scope.kind.hint')}
        value={scope.pageKind ?? ''}
        options={[
          { value: '', label: t('options.scope.kind.any') },
          ...PAGE_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) })),
        ]}
        onChange={(e) => onChange(setPageKind(scope, (e.target.value || undefined) as PageKind | undefined))}
      />
        <TextField
          label={t('options.scope.custom.label')}
          hint={t('options.scope.custom.hint')}
          error={errorsAt(issues, `${path}.pageType`)[0]}
          value={scope.pageType ?? ''}
          onChange={(e) => onChange({ ...scope, pageType: e.target.value })}
        />
      </Disclosure>
    </section>
  );
}
