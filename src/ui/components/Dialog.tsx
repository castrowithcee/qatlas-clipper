import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '../../settings/SettingsProvider';
import { IconButton } from './Button';
import './components.css';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  /** Action buttons, right-aligned under the content. */
  actions?: ReactNode;
  /** False: only the actions can end the dialog; Escape, backdrop and the close button do nothing (the latter is hidden). */
  dismissible?: boolean;
  /** `panel`: side panel at the right window edge, full screen on narrow windows. */
  variant?: 'dialog' | 'panel';
}

/** Modal on the native `<dialog>`: the browser inerts the page; Tab wrapping, Escape and focus return are handled here as well. */
export function Dialog({ open, onClose, title, children, actions, dismissible = true, variant = 'dialog' }: Props) {
  const close = () => dismissible && onClose();
  const i18n = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const first = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return e.preventDefault();
      const wrapTo = e.shiftKey && document.activeElement === firstItem ? lastItem : !e.shiftKey && document.activeElement === lastItem ? firstItem : null;
      if (wrapTo) {
        e.preventDefault();
        wrapTo.focus();
      }
    }
  };

  return (
    <dialog
      ref={ref}
      className={variant === 'panel' ? 'q-dialog q-dialog--panel' : 'q-dialog'}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      {open && (
        <div className="q-dialog-body">
          <header className="q-dialog-header">
            <h2 id={titleId} className="q-dialog-title">
              {title}
            </h2>
            {dismissible && <IconButton icon="close" label={i18n.t('ui.close')} onClick={onClose} />}
          </header>
          <div>{children}</div>
          {actions && <footer className="q-dialog-actions">{actions}</footer>}
        </div>
      )}
    </dialog>
  );
}
