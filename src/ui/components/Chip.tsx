import { IconButton } from './Button';
import './components.css';

interface Props {
  label: string;
  /** Accessible name of the remove button, e.g. "Remove example.com". */
  removeLabel: string;
  onRemove(): void;
  /** Visually marks the chip, e.g. as the next one a Backspace removes. */
  marked?: boolean;
}

/** A removable value; render chips inside a `<ul>`. */
export function Chip({ label, removeLabel, onRemove, marked }: Props) {
  return (
    <li className={marked ? 'q-chip q-chip--marked' : 'q-chip'} data-marked={marked || undefined}>
      <span className="q-chip-label">{label}</span>
      <IconButton icon="close" label={removeLabel} className="q-chip-remove" onClick={onRemove} />
    </li>
  );
}
