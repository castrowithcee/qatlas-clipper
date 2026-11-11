import { useState, type KeyboardEvent } from 'react';
import type { Tag } from '../config';
import { useI18n } from '../settings';
import { Chip, Combobox } from '../ui/components';
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

/** Token field: assigned tags as chips in the field before a combobox input: typing filters the unassigned tags, Enter takes the highlighted one or the typed name. */
export function TagInput({ tags, assignedIds, error, onAssign, onRemove, onCreate }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string>();
  // The chip the next Backspace removes.
  const [marked, setMarked] = useState<string>();
  const assigned = tags.filter((x) => assignedIds.includes(x.id));
  const needle = text.trim().toLowerCase();
  const suggestions = tags.filter((x) => !assignedIds.includes(x.id) && x.name.toLowerCase().includes(needle));

  const reset = () => {
    setText('');
    setProblem(undefined);
    setMarked(undefined);
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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Backspace' || text !== '' || assigned.length === 0) return;
    e.preventDefault();
    const last = assigned[assigned.length - 1]!;
    // The first Backspace only marks the last chip, the second one removes it.
    if (marked === last.id) {
      setMarked(undefined);
      onRemove(last.id);
    } else {
      setMarked(last.id);
    }
  };

  return (
    <div className="options-tag-input">
      <Combobox
        label={t('options.project.tags.label')}
        help={t('options.project.tags.help')}
        placeholder={t('options.project.tags.placeholder')}
        icon="tag"
        openIcon="tag"
        error={problem ?? error}
        text={text}
        onTextChange={(v) => {
          setText(v);
          setProblem(undefined);
          setMarked(undefined);
        }}
        tokens={assigned.map((x) => (
          <Chip key={x.id} label={x.name} marked={marked === x.id} removeLabel={t('options.project.tags.remove', { name: x.name })} onRemove={() => onRemove(x.id)} />
        ))}
        tokensLabel={t('options.project.tags.list')}
        groups={[{ id: 'tags', options: suggestions.map((x) => ({ value: x.id, label: x.name })) }]}
        listLabel={t('options.project.tags.suggestions')}
        onSelect={(id) => {
          const tag = tags.find((x) => x.id === id);
          if (tag) assign(tag);
        }}
        keepOpen
        onEnter={commit}
        onKeyDown={onKeyDown}
        onBlur={() => setMarked(undefined)}
      />
    </div>
  );
}
