import { useId, useState, type KeyboardEvent } from 'react';
import type { Tag } from '../config';
import { useI18n } from '../settings';
import { Button, Chip, TextField } from '../ui/components';
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
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState<string>();
  const assigned = tags.filter((x) => assignedIds.includes(x.id));
  const needle = text.trim().toLowerCase();
  const suggestions = tags.filter((x) => !assignedIds.includes(x.id) && x.name.toLowerCase().includes(needle));
  const shown = open && suggestions.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const reset = () => {
    setText('');
    setActive(-1);
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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = shown ? suggestions[active] : undefined;
      if (pick) assign(pick);
      else commit();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="options-tag-input">
      <div className="options-tag-add">
        <div className="options-tag-combo">
          <TextField
            label={t('options.project.tags.label')}
            help={t('options.project.tags.help')}
            hint={t('options.project.tags.hint')}
            error={problem ?? error}
            value={text}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={shown ? listId : undefined}
            aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(-1);
              setProblem(undefined);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
          />
          {shown && (
            <ul id={listId} role="listbox" className="options-tag-suggestions" aria-label={t('options.project.tags.suggestions')}>
              {suggestions.map((x, i) => (
                // Keyboard use goes through the combobox input; the options only need the pointer.
                <li
                  key={x.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'is-active' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => assign(x)}
                >
                  {x.name}
                </li>
              ))}
            </ul>
          )}
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
