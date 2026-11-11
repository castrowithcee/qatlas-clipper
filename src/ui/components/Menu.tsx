import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from './Button';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { placeTooltip } from './placeTooltip';
import './components.css';

export type MenuEntry =
  | { kind: 'action'; label: string; onSelect: () => void }
  | { kind: 'checkbox'; label: string; checked: boolean; onSelect: () => void }
  /** Mutually exclusive choice; entries with the same `group` label form one labelled group. */
  | { kind: 'radio'; label: string; group: string; checked: boolean; onSelect: () => void };

interface Props {
  /** Accessible name of the menu button. */
  label: string;
  icon?: IconName;
  entries: MenuEntry[];
  /** Tooltip of the menu button; the label is the default. */
  tooltip?: string;
  /** Extra props for the menu button. */
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

const ITEM = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

/**
 * Menu button following the WAI-ARIA menu button pattern. Selecting an entry closes the menu and returns focus to the
 * button; Escape and a click outside close it. The menu is fixed and clamped into the window.
 */
export function Menu({ label, icon = 'ellipsis-vertical', tooltip, entries, buttonProps }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Which item gets focus once the menu is shown: 'first' | 'last'.
  const focusOnOpen = useRef<'first' | 'last'>('first');

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    const place = () => {
      const view = { width: window.innerWidth, height: window.innerHeight };
      menu.style.maxHeight = `${Math.max(view.height - 8, 0)}px`;
      const size = menu.getBoundingClientRect();
      const trigger = button.getBoundingClientRect();
      // Aligned to the right edge of the button; placeTooltip clamps into the window and flips above when needed.
      const pos = placeTooltip({ left: trigger.right - size.width, top: trigger.top, width: trigger.width, height: trigger.height }, size, view);
      menu.style.left = `${pos.left}px`;
      menu.style.top = `${pos.top}px`;
    };
    place();
    const list = items();
    (focusOnOpen.current === 'last' ? list[list.length - 1] : list[0])?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const openWith = (which: 'first' | 'last') => {
    focusOnOpen.current = which;
    setOpen(true);
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openWith('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openWith('last');
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown': return go(at + 1);
      case 'ArrowUp': return go(at - 1);
      case 'Home': return go(0);
      case 'End': return go(list.length - 1);
      case 'Escape':
        e.preventDefault();
        // Keep the popup's other Escape handlers (tooltip, dialogs) out of this.
        e.stopPropagation();
        return close(true);
      case 'Tab':
        return close(false);
    }
  };

  const renderItem = (entry: MenuEntry, i: number) => {
    const role = entry.kind === 'action' ? 'menuitem' : entry.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitemradio';
    return (
      <button
        key={i}
        type="button"
        role={role}
        tabIndex={-1}
        className="q-menu-item"
        aria-checked={entry.kind === 'action' ? undefined : entry.checked}
        onClick={() => {
          close(true);
          entry.onSelect();
        }}
      >
        <span className="q-menu-mark" aria-hidden="true">
          {entry.kind !== 'action' && entry.checked && <Icon name="check" />}
        </span>
        {entry.label}
      </button>
    );
  };

  // Consecutive radios with the same group label become one labelled group, set off by separators.
  const nodes: ReactNode[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.kind !== 'radio') {
      nodes.push(renderItem(entry, i));
      continue;
    }
    const start = i;
    while (i + 1 < entries.length && entries[i + 1]!.kind === 'radio' && (entries[i + 1] as { group: string }).group === entry.group) i++;
    if (start > 0) nodes.push(<div key={`sep-${start}`} role="separator" className="q-menu-sep" />);
    nodes.push(
      <div key={`group-${start}`} role="group" aria-labelledby={`${id}-g${start}`}>
        <div id={`${id}-g${start}`} className="q-menu-heading">{entry.group}</div>
        {entries.slice(start, i + 1).map((e, k) => renderItem(e, start + k))}
      </div>,
    );
  }

  return (
    <span className="q-menu-wrap">
      <IconButton
        {...buttonProps}
        ref={buttonRef}
        icon={icon}
        label={label}
        tooltip={tooltip}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(true) : openWith('first'))}
        onKeyDown={onButtonKey}
      />
      {open && (
        <div ref={menuRef} id={id} role="menu" aria-label={label} className="q-menu" onKeyDown={onMenuKey}>
          {nodes}
        </div>
      )}
    </span>
  );
}
