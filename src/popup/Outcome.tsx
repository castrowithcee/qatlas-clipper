import type { ReactNode } from 'react';
import type { MessageKey } from '../i18n';
import { useI18n } from '../settings';
import { Button, Icon, type IconName } from '../ui/components';
import type { FailureKind, SendOutcome } from '../send/response';

/** Only http(s) URLs become links; webhook data is otherwise plain text. */
export function linkOf(value: string): string | undefined {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Popup wording per failure kind; the fixed English messages of the send core are never shown. */
const FAILURE_TEXT: Record<FailureKind, MessageKey> = {
  'network-error': 'popup.send.fail.network',
  timeout: 'popup.send.fail.timeout',
  'unknown-target': 'popup.send.fail.unknownTarget',
  'no-permission': 'popup.noPermission.text',
  'invalid-request': 'popup.send.fail.invalid',
  'in-flight': 'popup.send.fail.inFlight',
  'internal-error': 'popup.send.fail.internal',
};

type Kind = 'success' | 'error' | 'warning';
const ICON: Record<Kind, IconName> = { success: 'check', error: 'error', warning: 'alert' };

/** Meaning comes from icon and text, the colored edge only supports it. */
export function Notice({ kind, title, target, children }: { kind: Kind; title: string; target?: string; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div role={kind === 'success' ? 'status' : 'alert'} className={`popup-outcome popup-outcome--${kind}`}>
      <Icon name={ICON[kind]} />
      <div className="popup-outcome-body">
        {target !== undefined && <p className="popup-outcome-target">{t('popup.send.resultFor', { name: target })}</p>}
        <p className="popup-outcome-title">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function MissingHint({ target }: { target?: string }) {
  const { t } = useI18n();
  return <Notice kind="warning" title={t('popup.send.missing')} target={target} />;
}

export function ResultView({ outcome, at, onRetry, target }: { outcome: SendOutcome; at: string; onRetry: () => void; target?: string }) {
  const { t, number, date } = useI18n();
  if (outcome.kind === 'no-permission') return null;
  if (outcome.kind === 'success') {
    const href = outcome.url === undefined ? undefined : linkOf(outcome.url);
    const when = new Date(at);
    const title = Number.isNaN(when.getTime())
      ? t('popup.send.done')
      : t('popup.send.ok', { time: date(when, { timeStyle: 'short' }) });
    return (
      <Notice kind="success" title={title} target={target}>
        {outcome.message && <p className="popup-outcome-text">{outcome.message}</p>}
        {outcome.url !== undefined &&
          (href ? (
            <p className="popup-outcome-text"><a href={href} target="_blank" rel="noopener noreferrer">{href}</a></p>
          ) : (
            <p className="popup-outcome-text">{outcome.url}</p>
          ))}
      </Notice>
    );
  }
  const title =
    outcome.kind === 'http-error'
      ? t('popup.send.fail.http', { status: number(outcome.status, { useGrouping: false }) })
      : t(FAILURE_TEXT[outcome.kind]);
  return (
    <Notice kind="error" title={title} target={target}>
      {outcome.kind === 'http-error' && outcome.text && <p className="popup-outcome-text">{outcome.text}</p>}
      <Button className="popup-retry" onClick={onRetry}>{t('ui.retry')}</Button>
    </Notice>
  );
}
