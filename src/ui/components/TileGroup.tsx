import { useId } from 'react';
import { Icon, type IconName } from './Icon';
import './components.css';

export interface TileOption<T extends string> {
  value: T;
  label: string;
  icon: IconName;
}

interface Props<T extends string> {
  /** Group label, rendered as the fieldset legend. */
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: TileOption<T>[];
}

/** Single choice shown as tiles; native radios give arrow-key navigation and one tab stop. */
export function TileGroup<T extends string>({ legend, value, onChange, options }: Props<T>) {
  const name = useId();
  return (
    <fieldset className="q-tiles">
      <legend className="q-label">{legend}</legend>
      <div className="q-tiles-row">
        {options.map((o) => (
          <label key={o.value} className="q-tile">
            <input
              type="radio"
              className="q-tile-input"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            <span className="q-tile-body">
              <Icon name={o.icon} className="q-tile-icon" />
              <span>{o.label}</span>
              <Icon name="check" className="q-tile-check" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
