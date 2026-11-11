import { useState, type FormEvent } from 'react';
import type { Config } from '../config';
import type { MessageKey } from '../i18n';
import { useI18n } from '../settings';
import { Button, Dialog, EmptyState, TextField } from '../ui/components';
import { addTag, deleteTag, errorsAt, renameTag, tagNameError, tagUsage, type Issue } from './draft';

interface Props {
  config: Config;
  issues: Issue[];
  /** Edits the whole draft; saved with "Save" like everything else. */
  onEdit: (change: (config: Config) => Config) => void;
}

type Dialogs = { kind: 'rename'; id: string } | { kind: 'delete'; id: string };

export function TagsSection({ config, issues, onEdit }: Props) {
  const { t, tn } = useI18n();
  const tags = config.tags ?? [];
  const [name, setName] = useState('');
  // A missing name is reported only after an attempt.
  const [tried, setTried] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>();
  const problem = tagNameError(config, name);
  const error = problem && (tried || problem !== 'missing') ? t(nameKey(problem)) : undefined;
  const target = dialog ? tags.find((x) => x.id === dialog.id) : undefined;

  const create = (e?: FormEvent) => {
    e?.preventDefault();
    if (problem) return setTried(true);
    onEdit((c) => addTag(c, name.trim()));
    setName('');
    setTried(false);
  };

  return (
    <div className="options-tags-view">
      <header className="options-view-head">
        <h2>{t('options.tags.title')}</h2>
      </header>
      <p className="q-hint">{t('options.tags.intro')}</p>
      <form className="options-add options-tags-add" onSubmit={create} noValidate>
        <TextField
          label={t('options.tags.name')}
          hint={t('options.tags.nameHint')}
          value={name}
          error={error}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setTried(false);
          }}
        />
        <Button type="submit" icon="plus">{t('options.tags.add')}</Button>
      </form>
      {tags.length === 0 ? (
        <EmptyState title={t('options.tags.empty.title')} description={t('options.tags.empty.text')} />
      ) : (
        <ul className="options-tag-list" aria-label={t('options.tags.list')}>
          {tags.map((tag, i) => {
            const count = tagUsage(config, tag.id);
            const issue = errorsAt(issues, `tags[${i}].name`)[0];
            return (
              <li key={tag.id} className="options-tag-row" data-testid="options-tag">
                <span className="options-tag-name">{tag.name}</span>
                <span className="options-tag-count q-hint" data-testid="options-tag-count">{tn('options.tags.usage', count)}</span>
                <Button aria-label={t('options.tags.renameLabel', { name: tag.name })} onClick={() => setDialog({ kind: 'rename', id: tag.id })}>
                  {t('options.tags.rename')}
                </Button>
                <Button variant="danger" icon="trash" aria-label={t('options.tags.deleteLabel', { name: tag.name })} onClick={() => setDialog({ kind: 'delete', id: tag.id })}>
                  {t('options.tags.delete')}
                </Button>
                {issue && <p role="alert" className="options-tag-error">{issue}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {dialog?.kind === 'rename' && target && (
        <RenameDialog
          config={config}
          id={target.id}
          initial={target.name}
          onClose={() => setDialog(undefined)}
          onSubmit={(next) => onEdit((c) => renameTag(c, target.id, next))}
        />
      )}
      {dialog?.kind === 'delete' && target && (
        <Dialog
          open
          onClose={() => setDialog(undefined)}
          title={t('options.tags.deleteTitle')}
          actions={
            <>
              <Button onClick={() => setDialog(undefined)}>{t('options.cancel')}</Button>
              <Button variant="danger" icon="trash" onClick={() => { setDialog(undefined); onEdit((c) => deleteTag(c, target.id)); }}>
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

function RenameDialog({ config, id, initial, onClose, onSubmit }: { config: Config; id: string; initial: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [tried, setTried] = useState(false);
  const problem = tagNameError(config, name, id);
  const error = problem && (tried || problem !== 'missing') ? t(nameKey(problem)) : undefined;
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (problem) return setTried(true);
    onSubmit(name.trim());
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('options.tags.renameTitle')}
      actions={
        <>
          <Button onClick={onClose}>{t('options.cancel')}</Button>
          <Button variant="primary" onClick={send}>{t('options.tags.rename')}</Button>
        </>
      }
    >
      <form onSubmit={send} noValidate>
        <TextField data-autofocus label={t('options.tags.name')} hint={t('options.tags.nameHint')} value={name} error={error} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </form>
    </Dialog>
  );
}
