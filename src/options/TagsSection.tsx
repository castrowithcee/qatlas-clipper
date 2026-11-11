import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Config, Tag } from '../config';
import type { MessageKey } from '../i18n';
import { useI18n } from '../settings';
import { Button, Dialog, EmptyState, Icon, IconButton, Menu, TextField, type MenuEntry } from '../ui/components';
import { addTag, deleteTag, errorsAt, renameTag, tagNameError, tagUsage, type Issue } from './draft';

interface Props {
  config: Config;
  issues: Issue[];
  /** Edits the whole draft; saved with "Save" like everything else. */
  onEdit: (change: (config: Config) => Config) => void;
}

export function TagsSection({ config, issues, onEdit }: Props) {
  const { t, tn } = useI18n();
  const tags = config.tags ?? [];
  const [name, setName] = useState('');
  // A missing name is reported only after an attempt.
  const [tried, setTried] = useState(false);
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const problem = tagNameError(config, name);
  const error = problem && (tried || problem !== 'missing') ? t(nameKey(problem)) : undefined;
  const target = deleting ? tags.find((x) => x.id === deleting) : undefined;

  const create = (e?: FormEvent) => {
    e?.preventDefault();
    if (problem) return setTried(true);
    onEdit((c) => addTag(c, name.trim()));
    setName('');
    setTried(false);
  };

  const menu = (tag: Tag): MenuEntry[] => [
    { kind: 'action', icon: 'pencil', label: t('options.tags.rename'), onSelect: () => setRenaming(tag.id) },
    { kind: 'separator' },
    { kind: 'action', icon: 'trash', danger: true, label: t('options.tags.delete'), onSelect: () => setDeleting(tag.id) },
  ];

  return (
    <div className="options-tags-view">
      <header className="options-view-head">
        <span className="options-title-row">
          <h2>{t('options.tags.title')}</h2>
          <IconButton icon="info" label={t('ui.moreInfo')} tooltip={t('options.tags.intro')} className="q-help" />
        </span>
      </header>
      <form className="options-add options-tags-add" onSubmit={create} noValidate>
        <TextField
          label={t('options.tags.name')}
          value={name}
          error={error}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setTried(false);
          }}
        />
        <IconButton type="submit" icon="plus" label={t('options.tags.add')} />
      </form>
      {tags.length === 0 ? (
        <EmptyState title={t('options.tags.empty.title')} description={t('options.tags.empty.text')} />
      ) : (
        <ul className="options-tag-list" aria-label={t('options.tags.list')}>
          {tags.map((tag, i) => {
            const count = tagUsage(config, tag.id);
            const issue = errorsAt(issues, `tags[${i}].name`)[0];
            return (
              <li key={tag.id} className="options-tag-row options-row" data-testid="options-tag" data-tag-id={tag.id}>
                {renaming === tag.id ? (
                  <TagNameInput
                    config={config}
                    tag={tag}
                    onRename={(next) => onEdit((c) => renameTag(c, tag.id, next))}
                    onDone={(restore) => {
                      setRenaming(undefined);
                      if (restore) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(tag.id)}"] [aria-haspopup="menu"]`)?.focus());
                    }}
                  />
                ) : (
                  <span className="options-tag-name">{tag.name}</span>
                )}
                <span className="options-tag-count q-hint" data-testid="options-tag-count">{tn('options.tags.usage', count)}</span>
                <Menu label={t('options.tags.menu', { name: tag.name })} entries={menu(tag)} />
                {issue && <p role="alert" className="options-tag-error">{issue}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {target && (
        <Dialog
          open
          onClose={() => setDeleting(undefined)}
          title={t('options.tags.deleteTitle')}
          actions={
            <>
              <Button onClick={() => setDeleting(undefined)}>{t('options.cancel')}</Button>
              <Button variant="danger" icon="trash" onClick={() => { setDeleting(undefined); onEdit((c) => deleteTag(c, target.id)); }}>
                {t('options.tags.deleteConfirm')}
              </Button>
            </>
          }
        >
          {(() => {
            const count = tagUsage(config, target.id);
            return <p>{count === 0 ? t('options.tags.deleteTextUnused', { name: target.name }) : tn('options.tags.deleteText', count, { name: target.name })}</p>;
          })()}
        </Dialog>
      )}
    </div>
  );
}

export const nameKey = (problem: 'missing' | 'tooLong' | 'taken'): MessageKey =>
  problem === 'missing' ? 'options.tags.nameMissing' : problem === 'tooLong' ? 'options.tags.nameTooLong' : 'options.tags.nameTaken';

/** The name of a tag, edited in its row: Enter and a valid blur apply it, Escape leaves it as it was. */
function TagNameInput({ config, tag, onRename, onDone }: { config: Config; tag: Tag; onRename: (name: string) => void; onDone: (restore: boolean) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(tag.name);
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const errorId = `options-tag-name-error-${tag.id}`;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const problem = tagNameError(config, name, tag.id);
  const error = problem && (tried || problem !== 'missing') ? t(nameKey(problem)) : undefined;
  const commit = (restore: boolean) => {
    if (problem) return setTried(true);
    finished.current = true;
    if (name.trim() !== tag.name) onRename(name.trim());
    onDone(restore);
  };
  return (
    <div className="options-tag-edit">
      <input
        ref={input}
        className="q-input"
        value={name}
        aria-label={t('options.tags.renameLabel', { name: tag.name })}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value);
          setTried(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finished.current = true;
            onDone(true);
          }
        }}
        onBlur={() => {
          if (!finished.current) commit(false);
        }}
      />
      {error && (
        <p id={errorId} className="q-error">
          <Icon name="error" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
