import { Button, EmptyState, ErrorState, LoadingState } from '../ui/components';
import { useI18n } from '../settings';
import type { MessageKey } from '../i18n';
import { Notice } from './Outcome';

/** Why the popup cannot show the form. `unsupported`, `no-access` and `failed` come from reading the tab. */
export type BlockReason = 'unsupported' | 'no-access' | 'failed' | 'no-tab' | 'load-failed';

export function LoadingView() {
  const { t } = useI18n();
  return <LoadingState label={t('popup.loading')} />;
}

/** Host of a match pattern such as `https://example.com/*`; foreign data, rendered as text only. */
const siteOf = (pattern: string) => pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');

const TEXT: Record<BlockReason, { title?: MessageKey; text: MessageKey }> = {
  unsupported: { title: 'popup.unreadable.title', text: 'popup.unreadable.text' },
  'no-access': { title: 'popup.noAccess.title', text: 'popup.noAccess.text' },
  failed: { text: 'popup.failed.text' },
  'no-tab': { text: 'popup.noTab.text' },
  'load-failed': { text: 'popup.loadFailed.text' },
};

/** A page that cannot be read: unreadable pages get the options page as the only way on, the others a retry. */
export function BlockedView({
  reason,
  onRetry,
  onOpenOptions,
  access,
}: {
  reason: BlockReason;
  onRetry: () => void;
  onOpenOptions: () => void;
  /** Side panel only, for `no-access`: ask for the tab's origin when known, otherwise point to the toolbar button. */
  access?: { origin?: string; denied: boolean; onAllow: () => void };
}) {
  const { t } = useI18n();
  const { title, text } = TEXT[reason];
  const site = access?.origin ? siteOf(access.origin) : undefined;
  const message = !access ? t(text) : site ? t('popup.noAccess.siteText', { site }) : t('popup.noAccess.panelText');
  return (
    <>
      <ErrorState title={title && t(title)} message={message} onRetry={reason === 'unsupported' ? undefined : onRetry} />
      {access?.origin && (
        <div className="popup-actions">
          <Button variant="primary" onClick={access.onAllow}>{t('popup.noAccess.allow')}</Button>
        </div>
      )}
      {access?.denied && <p role="status" className="popup-error">{t('popup.noAccess.denied')}</p>}
      {reason === 'unsupported' && (
        <div className="popup-actions">
          <Button onClick={onOpenOptions}>{t('popup.header.options')}</Button>
        </div>
      )}
    </>
  );
}

export function NoProjectsView({ onOpenOptions }: { onOpenOptions: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t('popup.noProjects.title')}
      description={t('popup.noProjects.text')}
      action={<Button variant="primary" icon="plus" onClick={onOpenOptions}>{t('popup.noProjects.action')}</Button>}
    />
  );
}

export function NoTargetView({ onOpenOptions }: { onOpenOptions: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t('popup.noTarget.title')}
      description={t('popup.noTarget.text')}
      action={<Button variant="primary" icon="plus" onClick={onOpenOptions}>{t('popup.noTarget.action')}</Button>}
    />
  );
}

/** Host permission for a target address is missing; granting happens on the options page. */
export function NoPermissionView({ onOpenOptions }: { onOpenOptions: () => void }) {
  const { t } = useI18n();
  return (
    <Notice kind="warning" title={t('popup.noPermission.title')}>
      <p className="popup-outcome-text">{t('popup.noPermission.text')}</p>
      <Button className="popup-retry" onClick={onOpenOptions}>{t('popup.noPermission.action')}</Button>
    </Notice>
  );
}
