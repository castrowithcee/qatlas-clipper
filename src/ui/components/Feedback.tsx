import { useId, useState, type ReactNode } from 'react';
import { useI18n } from '../../settings/SettingsProvider';
import { Button, IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import './components.css';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

const TOAST_ICON: Record<ToastKind, IconName> = { info: 'info', success: 'check', warning: 'alert', error: 'error' };

interface ToastProps {
  kind?: ToastKind;
  children: ReactNode;
  onDismiss?(): void;
}

/** Errors are announced assertively (`alert`), everything else politely (`status`). Meaning is carried by icon and text, not by color alone. */
export function Toast({ kind = 'info', children, onDismiss }: ToastProps) {
  const i18n = useI18n();
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`q-toast q-toast--${kind}`}>
      <Icon name={TOAST_ICON[kind]} />
      <p className="q-toast-text">{children}</p>
      {onDismiss && <IconButton icon="close" label={i18n.t('ui.close')} onClick={onDismiss} />}
    </div>
  );
}

interface StateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: StateProps) {
  return (
    <div className="q-state">
      <Icon name="inbox" className="q-state-icon" />
      <p className="q-state-title">{title}</p>
      {description && <p className="q-hint">{description}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const i18n = useI18n();
  return (
    <div role="status" className="q-state">
      <span className="q-spinner" aria-hidden="true" />
      <p className="q-hint">{label ?? i18n.t('ui.loading')}</p>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?(): void;
}

export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  const i18n = useI18n();
  return (
    <div role="alert" className="q-state q-state--error">
      <Icon name="error" className="q-state-icon" />
      <p className="q-state-title">{title ?? i18n.t('ui.error')}</p>
      <p className="q-hint">{message}</p>
      {onRetry && <Button onClick={onRetry}>{i18n.t('ui.retry')}</Button>}
    </div>
  );
}

interface DisclosureProps {
  /** Defaults to the localized "Advanced". */
  title?: string;
  defaultOpen?: boolean;
  /** Keeps the panel open, e.g. while it holds an input with an error that must stay reachable. */
  forceOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ title, defaultOpen = false, forceOpen = false, children }: DisclosureProps) {
  const i18n = useI18n();
  const [openState, setOpen] = useState(defaultOpen);
  const open = openState || forceOpen;
  const id = useId();
  return (
    <div className="q-disclosure">
      <button type="button" className="q-disclosure-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!openState)}>
        <Icon name="chevron-down" className="q-disclosure-chevron" />
        {title ?? i18n.t('ui.advanced')}
      </button>
      <div id={`${id}-panel`} hidden={!open} className="q-disclosure-panel">
        {children}
      </div>
    </div>
  );
}
