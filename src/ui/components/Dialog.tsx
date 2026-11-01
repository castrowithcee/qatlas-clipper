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
}

/** Modal on the native `<dialog>`: the browser inerts the page; Tab wrapping, Escape and focus return are handled here as well. */
export function Dialog({ open, onClose, title, children, actions }: Props) {
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
      onClose();
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
      className="q-dialog"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {open && (
        <div className="q-dialog-body">
          <header className="q-dialog-header">
            <h2 id={titleId} className="q-dialog-title">
              {title}
            </h2>
            <IconButton icon="close" label={i18n.t('ui.close')} onClick={onClose} />
          </header>
          <div>{children}</div>
          {actions && <footer className="q-dialog-actions">{actions}</footer>}
        </div>
      )}
    </dialog>
  );
}
