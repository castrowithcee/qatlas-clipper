import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';
import './components.css';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
}

export function Button({ variant = 'secondary', icon, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={['q-button', `q-button--${variant}`, className].filter(Boolean).join(' ')} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: IconName;
  /** Required: the accessible name of a button without visible text; also the default tooltip. */
  label: string;
  /** Replaces the label as tooltip content; read as description, since it adds to the name. */
  tooltip?: string;
  /** Shows a spinner instead of the icon and sets aria-busy; the caller also disables the button. */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, tooltip, busy, className, type = 'button', onFocus, onBlur, 'aria-describedby': describedBy, ...rest }: IconButtonProps) {
  const content = tooltip ?? label;
  return (
    <Tooltip content={content} keepMounted={content !== label}>
      {(tip) => (
        <button
          type={type}
          aria-label={label}
          className={['q-button', 'q-button--icon', className].filter(Boolean).join(' ')}
          {...rest}
          aria-busy={busy || undefined}
          // A tooltip equal to the name must not be announced a second time.
          aria-describedby={[describedBy, content !== label ? tip['aria-describedby'] : undefined].filter(Boolean).join(' ') || undefined}
          onFocus={(e) => {
            tip.onFocus();
            onFocus?.(e);
          }}
          onBlur={(e) => {
            tip.onBlur();
            onBlur?.(e);
          }}
        >
          {busy ? <span className="q-spinner q-spinner--small" aria-hidden="true" /> : <Icon name={icon} />}
        </button>
      )}
    </Tooltip>
  );
}
