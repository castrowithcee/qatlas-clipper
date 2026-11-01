import { useState } from 'react';
import type { Project } from '../config';
import { useI18n } from '../settings';
import { Button, Dialog, IconButton, Tooltip } from '../ui/components';

interface Props {
  projects: Project[];
  selectedIndex: number;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onDelete: (id: string) => void;
}

export function ProjectList({ projects, selectedIndex, onSelect, onAdd, onMove, onDelete }: Props) {
  const { t } = useI18n();
  const [confirmId, setConfirmId] = useState<string>();
  const confirming = projects.find((p) => p.id === confirmId);
  const nameOf = (p: Project) => p.name || t('options.projects.unnamed');
  return (
    <nav aria-label={t('options.projects.title')} className="options-projects">
      <h2>{t('options.projects.title')}</h2>
      <ol>
        {projects.map((p, i) => {
          const name = nameOf(p);
          const order = t('options.projects.order');
          return (
            <li key={p.id} className={i === selectedIndex ? 'options-project is-current' : 'options-project'}>
              <button type="button" className="options-project-name" aria-current={i === selectedIndex ? 'true' : undefined} onClick={() => onSelect(p.id)}>
                {name}
              </button>
              <span className="options-project-actions">
                <Tooltip content={order}>
                  {(tip) => <IconButton icon="arrow-up" label={t('options.projects.moveUp', { name })} disabled={i === 0} onClick={() => onMove(i, -1)} {...tip} />}
                </Tooltip>
                <Tooltip content={order}>
                  {(tip) => (
                    <IconButton icon="arrow-down" label={t('options.projects.moveDown', { name })} disabled={i === projects.length - 1} onClick={() => onMove(i, 1)} {...tip} />
                  )}
                </Tooltip>
                <IconButton icon="trash" label={t('options.projects.delete', { name })} onClick={() => setConfirmId(p.id)} />
              </span>
            </li>
          );
        })}
      </ol>
      <Button icon="plus" onClick={onAdd}>
        {t('options.projects.add')}
      </Button>
      <Dialog
        open={Boolean(confirming)}
        onClose={() => setConfirmId(undefined)}
        title={t('options.projects.deleteTitle')}
        actions={
          <>
            <Button onClick={() => setConfirmId(undefined)}>{t('options.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirming) onDelete(confirming.id);
                setConfirmId(undefined);
              }}
            >
              {t('options.projects.deleteConfirm')}
            </Button>
          </>
        }
      >
        {confirming && <p>{t('options.projects.deleteText', { name: nameOf(confirming) })}</p>}
      </Dialog>
    </nav>
  );
}
