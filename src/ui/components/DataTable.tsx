import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import './components.css';

export type DataTableColumn = string | { label: string; /** Keep the header for assistive technology only (icon or action columns). */ hidden?: boolean; narrow?: boolean };

interface Props {
  /** Names the table; shown above it unless `captionHidden`. */
  caption: string;
  captionHidden?: boolean;
  columns: DataTableColumn[];
  /** The `<tr>` rows; mark a row with errors with `data-invalid` and a `RowError` cell content. */
  children: ReactNode;
}

/** Semantic table that scrolls horizontally inside its own area on narrow screens. */
export function DataTable({ caption, captionHidden, columns, children }: Props) {
  const captionId = useId();
  return (
    <div className="q-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="q-table">
        <caption id={captionId} className={captionHidden ? 'q-table-caption--hidden' : undefined}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const col: Exclude<DataTableColumn, string> = typeof c === 'string' ? { label: c } : c;
              return (
                <th key={i} scope="col" className={col.narrow ? 'q-table-narrow' : undefined}>
                  {col.hidden ? <span className="q-sr-only">{col.label}</span> : col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Row actions: visible on row hover and focus, always on touch; the space stays reserved and the buttons stay in tab order. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="q-row-actions">{children}</div>;
}

/** Error mark of a row: icon plus text, never color alone. */
export function RowError({ children }: { children: ReactNode }) {
  return (
    <span className="q-row-error">
      <Icon name="error" />
      {children}
    </span>
  );
}
