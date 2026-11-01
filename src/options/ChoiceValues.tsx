import { useId, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../settings';
import { Button, Chip, TextField } from '../ui/components';

interface Props {
  values: string[];
  /** Shown when the list is empty or the config reports a problem with it. */
  error?: string;
  onChange: (values: string[]) => void;
}

/** The values of a choice list as chips, with one input to add more. */
export function ChoiceValues({ values, error, onChange }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string>();

  const add = () => {
    const value = input.trim();
    if (value === '') {
      setInputError(undefined);
      return;
    }
    if (values.includes(value)) {
      setInputError(t('options.fields.values.duplicate'));
      return;
    }
    onChange([...values, value]);
    setInput('');
    setInputError(undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="options-values">
      {values.length > 0 && (
        <ul id={id} className="options-chips" aria-label={t('options.fields.values.list')}>
          {values.map((v, i) => (
            <Chip key={v} label={v} removeLabel={t('options.fields.values.remove', { value: v })} onRemove={() => onChange(values.filter((_, j) => j !== i))} />
          ))}
        </ul>
      )}
      <div className="options-add">
        <TextField
          label={t('options.fields.values.label')}
          hint={t('options.fields.values.hint')}
          error={inputError ?? (input === '' ? error : undefined)}
          value={input}
          autoComplete="off"
          onChange={(e) => {
            setInput(e.target.value);
            setInputError(undefined);
          }}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
        <Button icon="plus" onClick={add}>
          {t('options.fields.values.add')}
        </Button>
      </div>
    </div>
  );
}
