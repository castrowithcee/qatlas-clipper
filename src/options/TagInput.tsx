import { useState } from 'react';
import type { Tag } from '../config';
import { useI18n } from '../settings';
import { Button, Chip, Combobox } from '../ui/components';
import { nameErrorIn } from './draft';
import { nameKey } from './TagsSection';

interface Props {
  /** The central tag list. */
  tags: Tag[];
  assignedIds: string[];
  /** Messages for problems of the project's tag list itself. */
  error?: string;
  onAssign: (tagId: string) => void;
  onRemove: (tagId: string) => void;
  /** A name that is not in the list yet: the caller creates the tag and assigns it. */
  onCreate: (name: string) => void;
}

/** Assigned tags as chips plus a combobox: typing filters the unassigned tags, Enter takes the highlighted one or the typed name. */
export function TagInput({ tags, assignedIds, error, onAssign, onRemove, onCreate }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string>();
  const assigned = tags.filter((x) => assignedIds.includes(x.id));
  const needle = text.trim().toLowerCase();
  const suggestions = tags.filter((x) => !assignedIds.includes(x.id) && x.name.toLowerCase().includes(needle));

  const reset = () => {
    setText('');
    setProblem(undefined);
  };
  const assign = (tag: Tag) => {
    onAssign(tag.id);
    reset();
  };
  const commit = () => {
    const name = text.trim();
    if (name === '') return;
    const same = tags.find((x) => x.name.trim() === name);
    if (same) {
      if (assignedIds.includes(same.id)) return setProblem(t('options.project.tags.assigned'));
      return assign(same);
    }
    const failure = nameErrorIn(tags, name);
    if (failure) return setProblem(t(nameKey(failure)));
    onCreate(name);
    reset();
  };

  return (
    <div className="options-tag-input">
      <div className="options-tag-add">
        <div className="options-tag-combo">
          <Combobox
            label={t('options.project.tags.label')}
            help={t('options.project.tags.help')}
            hint={t('options.project.tags.hint')}
            error={problem ?? error}
            text={text}
            onTextChange={(v) => {
              setText(v);
              setProblem(undefined);
            }}
            groups={[{ id: 'tags', options: suggestions.map((x) => ({ value: x.id, label: x.name })) }]}
            listLabel={t('options.project.tags.suggestions')}
            onSelect={(id) => {
              const tag = tags.find((x) => x.id === id);
              if (tag) assign(tag);
            }}
            keepOpen
            onEnter={commit}
          />
        </div>
        <Button icon="plus" onClick={commit}>{t('options.project.tags.add')}</Button>
      </div>
      {assigned.length > 0 && (
        <ul className="options-chips" aria-label={t('options.project.tags.list')}>
          {assigned.map((x) => (
            <Chip key={x.id} label={x.name} removeLabel={t('options.project.tags.remove', { name: x.name })} onRemove={() => onRemove(x.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
