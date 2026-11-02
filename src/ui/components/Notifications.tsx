import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Toast, type ToastKind } from './Feedback';
import './components.css';

/** How long a success or hint message stays. Kept here, not in CSS, so the timer can pause. */
export const TOAST_DURATION_MS = 5000;

export interface Notifications {
  /** Shows a message and returns its id. An identical message that is still shown is replaced. */
  notify(kind: ToastKind, text: string): number;
  dismiss(id: number): void;
}

interface Item {
  id: number;
  kind: ToastKind;
  text: string;
}

const NotificationsContext = createContext<Notifications | undefined>(undefined);

export function useNotifications(): Notifications {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications needs a NotificationsProvider');
  return ctx;
}

/** Holds the messages above the views, so they survive views being remounted (e.g. reload after an import). */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);
  const notify = useCallback((kind: ToastKind, text: string) => {
    const id = nextId.current++;
    setItems((list) => [...list.filter((i) => i.kind !== kind || i.text !== text), { id, kind, text }]);
    return id;
  }, []);
  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <NotificationsContext.Provider value={api}>
      {children}
      <div className="q-toast-region">
        {items.map((item) => (
          <TimedToast key={item.id} item={item} dismiss={dismiss} />
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

/** Errors stay until closed. Others close on their own; hover or focus inside pauses the timer, which restarts afterwards. */
function TimedToast({ item, dismiss }: { item: Item; dismiss(id: number): void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const timed = item.kind !== 'error';
  const paused = hover || focus;

  useEffect(() => {
    if (!timed || paused) return;
    const timer = setTimeout(() => dismiss(item.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [timed, paused, dismiss, item.id]);

  return (
    <div
      className="q-toast-slot"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e: FocusEvent<HTMLDivElement>) => !e.currentTarget.contains(e.relatedTarget) && setFocus(false)}
    >
      <Toast kind={item.kind} onDismiss={() => dismiss(item.id)}>
        {item.text}
      </Toast>
    </div>
  );
}
