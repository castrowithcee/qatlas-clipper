import { useId, type ReactNode } from 'react';

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  multiline?: boolean;
  hint?: string;
  /** Use "password" for secrets so they are masked. */
  type?: 'text' | 'password';
}

export function TextInput({ label, value, onChange, errors = [], multiline, hint, type = 'text' }: TextInputProps) {
  const id = useId();
  const describedBy = [errors.length > 0 ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value,
    'aria-invalid': errors.length > 0 || undefined,
    'aria-describedby': describedBy,
  };
  return (
    <div className="row">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={4} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} autoComplete={type === 'password' ? 'off' : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {errors.length > 0 && (
        <p id={`${id}-err`} className="error">
          {errors.join('; ')}
        </p>
      )}
    </div>
  );
}

interface ItemButtonsProps {
  noun: string;
  name: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  extra?: ReactNode;
}

/** Move up/down and delete for a list item; aria-labels name the item. */
export function ItemButtons({ noun, name, index, count, onMove, onDelete, extra }: ItemButtonsProps) {
  const what = `${noun} ${name}`;
  return (
    <span className="buttons">
      <button type="button" aria-label={`Move up ${what}`} disabled={index === 0} onClick={() => onMove(-1)}>
        Move up
      </button>
      <button type="button" aria-label={`Move down ${what}`} disabled={index === count - 1} onClick={() => onMove(1)}>
        Move down
      </button>
      <button type="button" aria-label={`Delete ${what}`} onClick={onDelete}>
        Delete
      </button>
      {extra}
    </span>
  );
}
