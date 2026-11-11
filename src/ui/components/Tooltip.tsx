import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { placeTooltip } from './placeTooltip';
import './components.css';

export interface TooltipTriggerProps {
  'aria-describedby': string;
  onFocus(): void;
  onBlur(): void;
}

interface Props {
  content: string;
  /** Without it the tooltip is only in the DOM while shown; use it when nothing references the tooltip by `aria-describedby`. */
  keepMounted?: boolean;
  /** Renders the trigger; spread the given props on a focusable element. */
  children: (props: TooltipTriggerProps) => ReactNode;
}

/** Shown on focus and hover, closed by Escape or leaving; stays in the DOM (hidden) so `aria-describedby` always resolves. */
export function Tooltip({ content, keepMounted = true, children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => setOpen(false), []);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const wrap = wrapRef.current;
      const tip = tipRef.current;
      if (!wrap || !tip) return;
      const gap = parseFloat(getComputedStyle(tip).marginTop) || 0;
      const pos = placeTooltip(wrap.getBoundingClientRect(), tip.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, gap);
      tip.style.left = `${pos.left}px`;
      tip.style.top = `${pos.top}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span ref={wrapRef} className="q-tooltip-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={hide}>
      {children({ 'aria-describedby': id, onFocus: () => setOpen(true), onBlur: hide })}
      {(open || keepMounted) && (
        <span ref={tipRef} role="tooltip" id={id} hidden={!open} className="q-tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
