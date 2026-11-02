import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icon, type IconName } from './Icon';
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
  /** Required: the accessible name of a button without visible text. */
  label: string;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={['q-button', 'q-button--icon', className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
