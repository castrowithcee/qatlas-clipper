import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { Button, Dialog, MarkdownView } from '../ui/components';
import { useI18n } from '../settings';

/** Most lines a field input shows before it fades out and offers the full preview. */
export const MAX_LINES = 5;

/**
 * Whether the content is taller than the visible box. Without layout (clientHeight 0, e.g. happy-dom) the number of
 * lines in the value stands in, so tests can trigger it; in a browser soft-wrapped long lines are measured.
 */
export function overflows(el: Pick<HTMLElement, 'clientHeight' | 'scrollHeight'>, value: string): boolean {
  if (el.clientHeight > 0) return el.scrollHeight > el.clientHeight + 1;
  return value.split('\n').length > MAX_LINES;
}

type Control = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className' | 'rows'>;

interface Props {
  /** Props from `Field` (id, aria-*) and further native attributes. */
  control: Control;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Show the preview with Markdown formatting (only for values from clicked elements in Markdown format). */
  markdown: boolean;
}

/**
 * Text area that grows with its content up to MAX_LINES. Longer values fade out at the bottom; "Show more" opens a
 * modal preview of the full value with a switch to a large edit area that feeds the same `onChange`.
 */
export function LongValue({ control, label, value, onChange, markdown }: Props) {
  const { t } = useI18n();
  const area = useRef<HTMLTextAreaElement>(null);
  const edit = useRef<HTMLTextAreaElement>(null);
  const [over, setOver] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const measure = () => {
    const el = area.current;
    if (!el) return;
    setOver(overflows(el, value));
    // No layout (clientHeight 0) counts as not scrolled to the end.
    setAtEnd(el.clientHeight > 0 && el.scrollHeight - el.scrollTop - el.clientHeight <= 1);
  };
  useLayoutEffect(measure, [value]);

  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (editing) edit.current?.focus();
  }, [editing]);

  const close = () => {
    setOpen(false);
    setEditing(false);
  };

  return (
    <div className="popup-long">
      <div className="popup-long-box">
        <textarea {...control} ref={area} className="q-input popup-value" rows={1} value={value} onScroll={measure} onChange={(e) => onChange(e.target.value)} />
        {over && !atEnd && <span className="popup-long-fade" aria-hidden="true" />}
      </div>
      {/* Stays while the dialog is open so focus can return to it even if editing makes the value short. */}
      {(over || open) && (
        <Button className="popup-long-more" onClick={() => setOpen(true)}>
          {t('popup.long.more')}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={close}
        title={label}
        actions={<Button onClick={() => setEditing((v) => !v)}>{editing ? t('popup.long.preview') : t('popup.long.edit')}</Button>}
      >
        {editing ? (
          <textarea
            ref={edit}
            className="q-input popup-long-edit"
            aria-label={t('popup.long.editArea', { label })}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="popup-long-preview">{markdown ? <MarkdownView source={value} /> : <p className="popup-long-text">{value}</p>}</div>
        )}
      </Dialog>
    </div>
  );
}
