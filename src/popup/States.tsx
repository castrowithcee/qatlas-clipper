import { Button, EmptyState, ErrorState, LoadingState } from '../ui/components';
import { useI18n } from '../settings';
import type { MessageKey } from '../i18n';

/** Why the popup cannot show the form. `unsupported`, `no-access` and `failed` come from reading the tab. */
export type BlockReason = 'unsupported' | 'no-access' | 'failed' | 'no-tab' | 'load-failed';

export function LoadingView() {
  const { t } = useI18n();
  return <LoadingState label={t('popup.loading')} />;
}

const TEXT: Record<BlockReason, { title?: MessageKey; text: MessageKey }> = {
  unsupported: { title: 'popup.unreadable.title', text: 'popup.unreadable.text' },
  'no-access': { title: 'popup.noAccess.title', text: 'popup.noAccess.text' },
  failed: { text: 'popup.failed.text' },
  'no-tab': { text: 'popup.noTab.text' },
  'load-failed': { text: 'popup.loadFailed.text' },
};

/** A page that cannot be read: unreadable pages get the options page as the only way on, the others a retry. */
export function BlockedView({ reason, onRetry, onOpenOptions }: { reason: BlockReason; onRetry: () => void; onOpenOptions: () => void }) {
  const { t } = useI18n();
  const { title, text } = TEXT[reason];
  return (
    <>
      <ErrorState title={title && t(title)} message={t(text)} onRetry={reason === 'unsupported' ? undefined : onRetry} />
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
    <div role="alert" className="popup-permission">
      <p className="popup-permission-title">{t('popup.noPermission.title')}</p>
      <p className="q-hint">{t('popup.noPermission.text')}</p>
      <Button onClick={onOpenOptions}>{t('popup.noPermission.action')}</Button>
    </div>
  );
}
