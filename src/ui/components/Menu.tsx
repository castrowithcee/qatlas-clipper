import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, type ComponentType } from 'react';
import { IconButton } from './Button';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { placeTooltip } from './placeTooltip';
import './components.css';

/** Shared by all selectable entries; labels are rendered as text only. */
interface EntryBase {
  label: string;
  /** Leading icon. */
  icon?: IconName;
  /** Shown but not selectable and skipped by the arrow keys. */
  disabled?: boolean;
  /** Tooltip text, e.g. the reason an entry is disabled. */
  hint?: string;
  onSelect: () => void;
}

export type MenuEntry =
  /** `danger` is for deleting and removing only. */
  | (EntryBase & { kind: 'action'; danger?: boolean })
  /** Shows a check when on and an empty box when off. */
  | (EntryBase & { kind: 'checkbox'; checked: boolean })
  /** Mutually exclusive choice; entries with the same `group` label form one labelled group. */
  | (EntryBase & { kind: 'radio'; group: string; checked: boolean })
  /** Free divider between any two entries. */
  | { kind: 'separator' };

type SelectableEntry = Exclude<MenuEntry, { kind: 'separator' }>;

/** What a custom trigger must spread onto its focusable element, together with the ref. */
export interface MenuTriggerProps {
  ref: Ref<HTMLElement>;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick(): void;
  onKeyDown(e: KeyboardEvent): void;
}

interface Props {
  /** Accessible name of the menu button. */
  label: string;
  icon?: IconName;
  entries: MenuEntry[];
  /** Tooltip of the menu button; the label is the default. */
  tooltip?: string;
  /** Extra props for the default menu button. */
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  /** Replaces the default icon button; a component defined outside any render that puts the given props and ref on one focusable element. */
  trigger?: ComponentType<MenuTriggerProps>;
}

const ITEM = ['menuitem', 'menuitemcheckbox', 'menuitemradio'].map((r) => `[role="${r}"]:not([aria-disabled="true"])`).join(',');

/**
 * Menu button following the WAI-ARIA menu button pattern. Selecting an entry closes the menu and returns focus to the
 * button; Escape and a click outside close it. The menu is fixed and clamped into the window.
 */
export function Menu({ label, icon = 'ellipsis-vertical', tooltip, entries, buttonProps, trigger: Trigger }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLElement | null>(null);
  const setButton = useCallback((node: HTMLElement | null) => {
    buttonRef.current = node;
  }, []);
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

  const renderItem = (entry: SelectableEntry, i: number) => {
    const role = entry.kind === 'action' ? 'menuitem' : entry.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitemradio';
    const danger = entry.kind === 'action' && entry.danger;
    const mark =
      entry.kind === 'action' ? (entry.icon && <Icon name={entry.icon} />) : entry.checked ? <Icon name="check" /> : entry.kind === 'checkbox' ? <Icon name="square" /> : null;
    return (
      <button
        key={i}
        type="button"
        role={role}
        tabIndex={-1}
        className={['q-menu-item', danger && 'q-menu-item--danger'].filter(Boolean).join(' ')}
        aria-checked={entry.kind === 'action' ? undefined : entry.checked}
        aria-disabled={entry.disabled || undefined}
        title={entry.hint}
        onClick={() => {
          if (entry.disabled) return;
          close(true);
          entry.onSelect();
        }}
      >
        <span className="q-menu-mark" aria-hidden="true">{mark}</span>
        {entry.kind !== 'action' && entry.icon && <Icon name={entry.icon} />}
        {entry.label}
      </button>
    );
  };

  // Consecutive radios with the same group label become one labelled group, set off by separators.
  const nodes: ReactNode[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.kind === 'separator') {
      nodes.push(<div key={i} role="separator" className="q-menu-sep" />);
      continue;
    }
    if (entry.kind !== 'radio') {
      nodes.push(renderItem(entry, i));
      continue;
    }
    const start = i;
    while (i + 1 < entries.length && entries[i + 1]!.kind === 'radio' && (entries[i + 1] as { group: string }).group === entry.group) i++;
    if (start > 0 && entries[start - 1]!.kind !== 'separator') nodes.push(<div key={`sep-${start}`} role="separator" className="q-menu-sep" />);
    nodes.push(
      <div key={`group-${start}`} role="group" aria-labelledby={`${id}-g${start}`}>
        <div id={`${id}-g${start}`} className="q-menu-heading">{entry.group}</div>
        {entries.slice(start, i + 1).map((e, k) => renderItem(e as SelectableEntry, start + k))}
      </div>,
    );
  }

  const triggerProps: MenuTriggerProps = {
    ref: setButton,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: () => (open ? close(true) : openWith('first')),
    onKeyDown: onButtonKey,
  };

  return (
    <span className="q-menu-wrap">
      {Trigger ? (
        <Trigger {...triggerProps} />
      ) : (
        <IconButton
          {...buttonProps}
          {...(triggerProps as Omit<MenuTriggerProps, 'ref'>)}
          ref={setButton}
          icon={icon}
          label={label}
          tooltip={tooltip}
        />
      )}
      {open && (
        <div ref={menuRef} id={id} role="menu" aria-label={label} className="q-menu" onKeyDown={onMenuKey}>
          {nodes}
        </div>
      )}
    </span>
  );
}
