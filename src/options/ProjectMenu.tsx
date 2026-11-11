import { useState } from 'react';
import { useI18n } from '../settings';
import { Button, Dialog, Menu, type MenuEntry } from '../ui/components';

interface Props {
  /** Project name; only used as text in the accessible name and the confirmation. */
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  /** With at least one folder, the menu offers "Move to folder"; `current` is the folder id or `''`. */
  folders?: { id: string; name: string }[];
  currentFolder?: string;
  onMoveToFolder?: (folderId: string | undefined) => void;
  onExport: () => void;
  onDelete: () => void;
}

/** Options menu of one project, shared by the sidebar rows and the project title. Deleting asks first. */
export function ProjectMenu({ name, canMoveUp, canMoveDown, onMove, folders = [], currentFolder = '', onMoveToFolder, onExport, onDelete }: Props) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const entries: MenuEntry[] = [
    { kind: 'action', icon: 'arrow-up', label: t('options.menu.moveUp'), disabled: !canMoveUp, onSelect: () => onMove(-1) },
    { kind: 'action', icon: 'arrow-down', label: t('options.menu.moveDown'), disabled: !canMoveDown, onSelect: () => onMove(1) },
    ...(onMoveToFolder && folders.length > 0
      ? ([
          { kind: 'separator' },
          { kind: 'radio', group: t('options.menu.moveToFolder'), label: t('options.project.folder.none'), checked: currentFolder === '', onSelect: () => onMoveToFolder(undefined) },
          ...folders.map((f) => ({ kind: 'radio' as const, group: t('options.menu.moveToFolder'), label: f.name || t('options.folders.unnamed'), checked: currentFolder === f.id, onSelect: () => onMoveToFolder(f.id) })),
          { kind: 'separator' },
        ] satisfies MenuEntry[])
      : []),
    { kind: 'action', icon: 'file-export', label: t('options.share.export'), onSelect: onExport },
    { kind: 'separator' },
    { kind: 'action', icon: 'trash', danger: true, label: t('options.projects.deleteConfirm'), onSelect: () => setConfirming(true) },
  ];
  return (
    <>
      <Menu label={t('options.project.menu', { name })} entries={entries} />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('options.projects.deleteTitle')}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('options.cancel')}</Button>
            <Button variant="danger" icon="trash" onClick={() => { setConfirming(false); onDelete(); }}>
              {t('options.projects.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('options.projects.deleteText', { name })}</p>
      </Dialog>
    </>
  );
}
