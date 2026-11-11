import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { Field, type FieldProps } from './Field';
import './components.css';

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'aria-invalid'>;

interface TextFieldProps extends NativeInput, FieldProps {
  type?: 'text' | 'url' | 'email' | 'number' | 'search' | 'password';
}

export function TextField({ label, hint, error, help, type = 'text', className, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} help={help} disabled={rest.disabled}>
      {(control) => <input {...rest} {...control} type={type} className={['q-input', className].filter(Boolean).join(' ')} />}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children' | 'aria-invalid'>, FieldProps {
  options: readonly SelectOption[];
  /** Rendered after `options` as `<optgroup>`s; labels are plain text. */
  groups?: readonly { label: string; options: readonly SelectOption[] }[];
}

/** Native `<select>`: keyboard, typeahead and platform popup come for free. */
export function Select({ label, hint, error, help, options, groups, className, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} help={help} disabled={rest.disabled}>
      {(control) => (
        <select {...rest} {...control} className={['q-input', 'q-select', className].filter(Boolean).join(' ')}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {groups?.map((g, i) => (
            <optgroup key={i} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </Field>
  );
}

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'role' | 'aria-invalid'> & FieldProps;

export function Checkbox({ label, hint, error, help, className, ...rest }: ToggleProps) {
  return (
    <Field label={label} hint={hint} error={error} help={help} labelPosition="after" disabled={rest.disabled}>
      {(control) => <input {...rest} {...control} type="checkbox" className={['q-check', className].filter(Boolean).join(' ')} />}
    </Field>
  );
}

/** A checkbox with `role="switch"`: announced as on/off, toggled with Space. */
export function Switch({ label, hint, error, help, className, ...rest }: ToggleProps) {
  return (
    <Field label={label} hint={hint} error={error} help={help} labelPosition="after" disabled={rest.disabled}>
      {(control) => <input {...rest} {...control} type="checkbox" role="switch" className={['q-switch', className].filter(Boolean).join(' ')} />}
    </Field>
  );
}
