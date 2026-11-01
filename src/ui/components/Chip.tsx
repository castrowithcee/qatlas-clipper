import { IconButton } from './Button';
import './components.css';

interface Props {
  label: string;
  /** Accessible name of the remove button, e.g. "Remove example.com". */
  removeLabel: string;
  onRemove(): void;
}

/** A removable value; render chips inside a `<ul>`. */
export function Chip({ label, removeLabel, onRemove }: Props) {
  return (
    <li className="q-chip">
      <span className="q-chip-label">{label}</span>
      <IconButton icon="close" label={removeLabel} className="q-chip-remove" onClick={onRemove} />
    </li>
  );
}
