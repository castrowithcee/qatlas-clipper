import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { Field, type FieldProps } from './Field';
import { Icon, type IconName } from './Icon';
import './components.css';

export interface ComboboxOption {
  value: string;
  /** Rendered as text only. */
  label: string;
}

export interface ComboboxGroup {
  id: string;
  /** Heading row, not selectable and skipped by the arrow keys; options are indented under it. */
  label?: string;
  icon?: IconName;
  options: readonly ComboboxOption[];
}

type NativeInput = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type' | 'role' | 'value' | 'onChange' | 'onSelect' | 'aria-invalid' | 'aria-expanded' | 'aria-controls' | 'aria-activedescendant' | 'aria-autocomplete'
>;

interface Props extends NativeInput, FieldProps {
  /** Already filtered by the caller. */
  groups: readonly ComboboxGroup[];
  /** What the user typed. */
  text: string;
  onTextChange: (text: string) => void;
  onSelect: (value: string) => void;
  /** Accessible name of the list. */
  listLabel: string;
  /** Shown instead of the list when `groups` is empty and nothing is typed; without it the list stays closed. */
  emptyText?: string;
  /** Shown instead of the list when `groups` is empty after typing; without it the list stays closed. */
  noResultsText?: string;
  /** Marks this option and starts the highlight on it when the list opens. */
  selectedValue?: string;
  /** Shown in the input while the list is closed (the current choice); typing happens with it empty. */
  closedText?: string;
  /** Leading icon while closed and while open. */
  icon?: IconName;
  openIcon?: IconName;
  /** Highlights the first option while typing, so Enter takes it. */
  autoActivate?: boolean;
  /** Keep the list open after a selection (the caller refills it). Default: close. */
  keepOpen?: boolean;
  /** Enter without a highlighted option. */
  onEnter?: () => void;
  /** The list closed without a selection (Escape or leaving the field). */
  onCancel?: () => void;
}

const EDGE = 8;

/**
 * Combobox with a listbox following the WAI-ARIA combobox pattern: the input keeps focus, arrow keys move
 * `aria-activedescendant`, Enter takes the highlighted option, Escape closes without changing anything.
 * All labels are rendered as text; the panel stays inside the window (flips above, clamps its height).
 */
export function Combobox({
  label, hint, error, help, groups, text, onTextChange, onSelect, listLabel, emptyText, noResultsText, selectedValue,
  closedText, icon = 'search', openIcon = 'search', autoActivate = false, keepOpen = false, onEnter, onCancel, className, ...rest
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flat = groups.flatMap((g) => g.options);
  const typed = text.trim() !== '';
  const message = flat.length > 0 ? undefined : typed ? noResultsText : emptyText;
  const shown = open && (flat.length > 0 || message !== undefined);
  const listed = shown && flat.length > 0;
  const current = listed && active >= 0 && active < flat.length ? active : -1;
  const optionId = (i: number) => `${listId}-${i}`;

  const openList = () => {
    if (open) return;
    setOpen(true);
    const i = selectedValue === undefined ? -1 : flat.findIndex((o) => o.value === selectedValue);
    setActive(i >= 0 ? i : autoActivate && flat.length > 0 ? 0 : -1);
  };
  const cancel = () => {
    setOpen(false);
    setActive(-1);
    onCancel?.();
  };
  const choose = (o: ComboboxOption) => {
    onSelect(o.value);
    setActive(-1);
    if (!keepOpen) setOpen(false);
  };

  // Keep the panel inside the window: below the input when it fits, else above when there is more room.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const wrap = wrapRef.current;
    if (!shown || !panel || !wrap) return;
    panel.style.maxHeight = '';
    panel.style.top = '';
    panel.style.bottom = '';
    const box = wrap.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - EDGE;
    const above = box.top - EDGE;
    const flip = panel.offsetHeight > below && above > below;
    const room = flip ? above : below;
    panel.style.maxHeight = `${Math.max(room, 128)}px`;
    if (flip) {
      panel.style.top = 'auto';
      panel.style.bottom = '100%';
    }
  }, [shown, flat.length, message]);

  useLayoutEffect(() => {
    if (current >= 0) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    rest.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive(Math.min(current + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setActive(Math.max(current - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[current];
      if (pick) choose(pick);
      else onEnter?.();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      cancel();
    }
  };

  let index = 0;
  return (
    <Field label={label} hint={hint} error={error} help={help} disabled={rest.disabled}>
      {(control) => (
        <div className="q-combobox" ref={wrapRef}>
          <Icon name={open ? openIcon : icon} className="q-combobox-icon" />
          <input
            {...rest}
            {...control}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={listed ? listId : undefined}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            className={['q-input', 'q-combobox-input', className].filter(Boolean).join(' ')}
            value={open || closedText === undefined ? text : closedText}
            placeholder={(open ? closedText : undefined) ?? rest.placeholder}
            onChange={(e) => {
              onTextChange(e.target.value);
              setOpen(true);
              setActive(autoActivate ? 0 : -1);
            }}
            onFocus={(e) => {
              rest.onFocus?.(e);
              openList();
            }}
            onClick={(e) => {
              rest.onClick?.(e);
              openList();
            }}
            onBlur={(e) => {
              rest.onBlur?.(e);
              if (open) cancel();
            }}
            onKeyDown={onKeyDown}
          />
          {closedText !== undefined && <Icon name="chevron-down" className="q-combobox-chevron" />}
          {shown && (
            <div className="q-combobox-panel" ref={panelRef} onMouseDown={(e) => e.preventDefault()}>
              {listed && (
                <div id={listId} role="listbox" aria-label={listLabel}>
                  {groups.filter((g) => g.options.length > 0).map((g) => {
                    const headId = `${listId}-${g.id}`;
                    const rows = g.options.map((o) => {
                      const i = index++;
                      return (
                        <div
                          key={o.value}
                          id={optionId(i)}
                          role="option"
                          aria-selected={selectedValue === undefined ? i === current : o.value === selectedValue}
                          className={['q-combobox-option', g.label ? 'is-indented' : '', i === current ? 'is-active' : ''].filter(Boolean).join(' ')}
                          onClick={() => choose(o)}
                        >
                          <span className="q-combobox-text">{o.label}</span>
                          {o.value === selectedValue && <Icon name="check" />}
                        </div>
                      );
                    });
                    return g.label ? (
                      <div key={g.id} role="group" aria-labelledby={headId}>
                        <div id={headId} role="presentation" className="q-combobox-group">
                          {g.icon && <Icon name={g.icon} />}
                          <span className="q-combobox-text">{g.label}</span>
                        </div>
                        {rows}
                      </div>
                    ) : (
                      <div key={g.id} role="group" aria-label={listLabel}>
                        {rows}
                      </div>
                    );
                  })}
                </div>
              )}
              {message !== undefined && <p className="q-combobox-message" role="status">{message}</p>}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}
