import { useId, type ReactNode } from 'react';
import { useI18n } from '../../settings/SettingsProvider';
import { Icon } from './Icon';
import { IconButton } from './Button';
import './components.css';

export interface FieldProps {
  label: string;
  /** Short helper text under the control. */
  hint?: string;
  /** Error text; shown with an icon and wired through `aria-invalid` and `aria-describedby`. */
  error?: string;
  /** Longer explanation, shown in a tooltip behind an info button. */
  help?: string;
}

interface ControlProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

interface Props extends FieldProps {
  /** `after` puts the label behind the control (checkbox, switch). */
  labelPosition?: 'top' | 'after';
  disabled?: boolean;
  children: (control: ControlProps) => ReactNode;
}

export function Field({ label, hint, error, help, labelPosition = 'top', disabled, children }: Props) {
  const i18n = useI18n();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const labelEl = (
    <label htmlFor={id} className="q-label">
      {label}
    </label>
  );
  const helpEl = help && (
    <IconButton icon="info" label={i18n.t('ui.moreInfo')} tooltip={help} className="q-help" />
  );
  const control = children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy });
  return (
    <div className={`q-field q-field--${labelPosition}`} data-disabled={disabled || undefined}>
      {labelPosition === 'top' ? (
        <>
          <span className="q-label-row">
            {labelEl}
            {helpEl}
          </span>
          {control}
        </>
      ) : (
        <span className="q-label-row">
          {control}
          {labelEl}
          {helpEl}
        </span>
      )}
      {hint && (
        <p id={hintId} className="q-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="q-error">
          <Icon name="error" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
