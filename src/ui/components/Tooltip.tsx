import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import './components.css';

export interface TooltipTriggerProps {
  'aria-describedby': string;
  onFocus(): void;
  onBlur(): void;
}

interface Props {
  content: string;
  /** Renders the trigger; spread the given props on a focusable element. */
  children: (props: TooltipTriggerProps) => ReactNode;
}

/** Shown on focus and hover, closed by Escape or leaving; stays in the DOM (hidden) so `aria-describedby` always resolves. */
export function Tooltip({ content, children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className="q-tooltip-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={hide}>
      {children({ 'aria-describedby': id, onFocus: () => setOpen(true), onBlur: hide })}
      <span role="tooltip" id={id} hidden={!open} className="q-tooltip">
        {content}
      </span>
    </span>
  );
}
