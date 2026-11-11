import { IconButton } from './Button';
import type { IconName } from './Icon';
import { Menu } from './Menu';
import './components.css';

export interface SplitButtonOption {
  id: string;
  label: string;
  /** Muted second line; rendered as text only. */
  detail?: string;
}

interface Props {
  icon: IconName;
  /** Accessible name and tooltip of the main part. */
  label: string;
  /** Name while busy; announced through aria-busy and the changed name. */
  busyLabel?: string;
  busy?: boolean;
  onMain: () => void;
  /** Name of the arrow part and its menu; the arrow only exists with at least two options. */
  menuLabel: string;
  options?: SplitButtonOption[];
  onSelect?: (id: string) => void;
}

/** Primary icon button; with several options an arrow part opens a menu whose choice acts at once. */
export function SplitButton({ icon, label, busyLabel, busy = false, onMain, menuLabel, options = [], onSelect }: Props) {
  return (
    <span className="q-split">
      <IconButton icon={icon} label={busy && busyLabel ? busyLabel : label} busy={busy} disabled={busy} onClick={onMain} />
      {options.length > 1 && (
        <Menu
          label={menuLabel}
          icon="chevron-down"
          buttonProps={{ disabled: busy }}
          entries={options.map((o) => ({ kind: 'action', label: o.label, detail: o.detail, onSelect: () => onSelect?.(o.id) }))}
        />
      )}
    </span>
  );
}
