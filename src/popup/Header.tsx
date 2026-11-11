import { IconButton, Select, Tooltip } from '../ui/components';
import { useI18n } from '../settings';

interface Props {
  projects: { id: string; name: string; folderId?: string; tagIds?: string[] }[];
  /** In folder order; names are rendered as text only. */
  folders?: { id: string; name: string }[];
  /** The central tag list; names are rendered as text only and follow its order behind the project name. */
  tags?: { id: string; name: string }[];
  matchingIds: string[];
  value: string;
  onChange: (id: string) => void;
  onOpenOptions: () => void;
  highlight: boolean;
  onToggleHighlight: () => void;
  /** Target view of the switch; undefined hides it (no side panel API). */
  switchTo?: 'popup' | 'sidepanel';
  onSwitchView?: () => void;
}

export function Header({ projects, folders = [], tags = [], matchingIds, value, onChange, onOpenOptions, highlight, onToggleHighlight, switchTo, onSwitchView }: Props) {
  const { t } = useI18n();
  const matching = projects.filter((p) => matchingIds.includes(p.id));
  const rest = projects.filter((p) => !matchingIds.includes(p.id));
  type Entry = (typeof projects)[number];
  const named = (p: Entry) => {
    const own = tags.filter((x) => p.tagIds?.includes(x.id)).map((x) => x.name);
    return own.length > 0 ? t('popup.project.withTags', { name: p.name, tags: own.join(', ') }) : p.name;
  };
  const toOption = (p: Entry) => ({ value: p.id, label: t('popup.project.noMatch', { name: named(p) }) });
  const known = new Set(folders.map((f) => f.id));
  const options = [
    ...matching.map((p) => ({ value: p.id, label: named(p) })),
    ...rest.filter((p) => !p.folderId || !known.has(p.folderId)).map(toOption),
  ];
  const groups = folders
    .map((f) => ({ label: f.name, options: rest.filter((p) => p.folderId === f.id).map(toOption) }))
    .filter((g) => g.options.length > 0);
  return (
    <header className="popup-header">
      <div className="popup-header-top">
        <Tooltip content={t('popup.header.highlight')}>
          {(tip) => (
            <IconButton
              icon={highlight ? 'eye' : 'eye-off'}
              label={t('popup.header.highlight')}
              aria-pressed={highlight}
              onClick={onToggleHighlight}
              {...tip}
            />
          )}
        </Tooltip>
        {switchTo && (
          <Tooltip content={t(switchTo === 'sidepanel' ? 'popup.header.toSidepanel' : 'popup.header.toPopup')}>
            {(tip) => (
              <IconButton
                icon={switchTo}
                label={t(switchTo === 'sidepanel' ? 'popup.header.toSidepanel' : 'popup.header.toPopup')}
                onClick={onSwitchView}
                {...tip}
              />
            )}
          </Tooltip>
        )}
        <Tooltip content={t('popup.header.options')}>
          {(tip) => <IconButton icon="settings" label={t('popup.header.options')} onClick={onOpenOptions} {...tip} />}
        </Tooltip>
      </div>
      <Select
        label={t('popup.project.label')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={options}
        groups={groups}
      />
    </header>
  );
}
