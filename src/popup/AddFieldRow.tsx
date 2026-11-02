import { useRef, useState, type KeyboardEvent } from 'react';
import { Button, Field } from '../ui/components';
import { useI18n } from '../settings';

interface Props {
  /** Saves the field and starts picking; rejects when saving failed. */
  onAdd: (label: string) => Promise<void>;
}

/** Row below the fields: label plus confirm. The typed label stays when saving fails. */
export function AddFieldRow({ onAdd }: Props) {
  const { t } = useI18n();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const empty = label.trim() === '';

  const submit = async () => {
    if (empty || running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onAdd(label);
      setLabel('');
    } catch {
      setError(t('popup.add.failed'));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && label !== '') {
      e.preventDefault();
      e.stopPropagation();
      setLabel('');
      setError(undefined);
    }
  };

  return (
    <Field label={t('popup.add.label')} help={t('popup.add.help')} error={error}>
      {(control) => (
        <div className="popup-control">
          <input
            {...control}
            className="q-input"
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button variant="secondary" icon="plus" disabled={empty || busy} onClick={() => void submit()}>
            {t('popup.add.button')}
          </Button>
        </div>
      )}
    </Field>
  );
}
