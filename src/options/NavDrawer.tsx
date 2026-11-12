import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n, useSettings } from '../settings';
import { IconButton } from '../ui/components';
import { useHash } from './route';

// Keep in sync with the 48rem breakpoint in options.css.
const NARROW = '(max-width: 48rem)';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useNarrow(): boolean {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : undefined;
  return useSyncExternalStore(
    (cb) => {
      media?.addEventListener('change', cb);
      return () => media?.removeEventListener('change', cb);
    },
    () => media?.matches ?? false,
  );
}

interface Collapse {
  controls: string;
  toggle: () => void;
}

const CollapseContext = createContext<Collapse | undefined>(undefined);

/** The collapse control for the sidebar header; undefined where there is nothing to collapse (narrow view, or already collapsed). */
export const useNavCollapse = () => useContext(CollapseContext);

interface Props {
  /** The full sidebar; it stays mounted while the drawer is closed so its view state survives. */
  sidebar: ReactNode;
  /** Name of the current view, shown next to the menu button in narrow windows. */
  title: string;
  children: ReactNode;
}

/** Wide: sidebar next to the content. Narrow: a header with a menu button opens the sidebar as a panel over the content. */
export function NavDrawer({ sidebar, title, children }: Props) {
  const { t } = useI18n();
  const narrow = useNarrow();
  const hash = useHash();
  // The panel is open for the address it was opened at, so choosing an entry (a new address) closes it without an effect.
  const [openedAt, setOpenedAt] = useState<string>();
  const open = narrow && openedAt === hash;
  const setOpen = (value: boolean) => setOpenedAt(value ? hash : undefined);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const shown = open;
  // Narrow view has its own menu; the stored setting has no effect there.
  const { settings, update } = useSettings();
  const collapsed = !narrow && settings.sidebarCollapsed;
  // Set by the buttons only: a settings update from elsewhere must not pull the focus out of what the user is doing.
  const moveFocus = useRef(false);
  const wasShown = useRef(false);

  useEffect(() => {
    if (shown) panel.current?.focus();
    else if (wasShown.current) button.current?.focus();
    wasShown.current = shown;
  }, [shown]);

  // Focus follows the change to the button that now offers the opposite action.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    document.querySelector<HTMLElement>(collapsed ? '[data-nav-expand]' : '[data-nav-collapse]')?.focus();
  }, [collapsed]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A menu or name field inside the panel handles its own Escape first.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return e.preventDefault();
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === e.currentTarget)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className={collapsed ? 'options-shell is-collapsed' : 'options-shell'}>
      {narrow && (
        <header className="options-topbar" inert={shown}>
          <IconButton
            ref={button}
            icon="menu"
            label={t('options.nav.open')}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(true)}
          />
          <p className="options-topbar-title">{title}</p>
        </header>
      )}
      {shown && <div className="options-scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div
        id={panelId}
        ref={panel}
        className="options-nav-slot"
        {...(narrow ? { role: 'dialog', 'aria-modal': true, 'aria-label': t('options.nav.label'), tabIndex: -1, hidden: !open, onKeyDown } : { hidden: collapsed })}
        onClick={(e) => {
          if (narrow && e.target instanceof Element && e.target.closest('a[href]')) setOpen(false);
        }}
      >
        <CollapseContext.Provider value={narrow || collapsed ? undefined : { controls: panelId, toggle: () => {
          moveFocus.current = true;
          void update({ sidebarCollapsed: true });
        } }}>
          {sidebar}
        </CollapseContext.Provider>
      </div>
      <main className="options-main" inert={shown}>
        {collapsed && (
          <IconButton
            data-nav-expand=""
            className="options-expand"
            icon="panel-left-open"
            label={t('options.nav.expand')}
            aria-expanded={false}
            aria-controls={panelId}
            onClick={() => {
              moveFocus.current = true;
              void update({ sidebarCollapsed: false });
            }}
          />
        )}
        {children}
      </main>
    </div>
  );
}
