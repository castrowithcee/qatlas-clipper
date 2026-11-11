import { IconButton, Select, Tooltip } from '../ui/components';
import { useI18n } from '../settings';

interface Props {
  projects: { id: string; name: string }[];
  matchingIds: string[];
  value: string;
  onChange: (id: string) => void;
  onOpenOptions: () => void;
}

export function Header({ projects, matchingIds, value, onChange, onOpenOptions }: Props) {
  const { t } = useI18n();
  return (
    <header className="popup-header">
      <div className="popup-header-top">
        <Tooltip content={t('popup.header.options')}>
          {(tip) => <IconButton icon="settings" label={t('popup.header.options')} onClick={onOpenOptions} {...tip} />}
        </Tooltip>
      </div>
      <Select
        label={t('popup.project.label')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={projects.map((p) => ({
          value: p.id,
          label: matchingIds.includes(p.id) ? p.name : t('popup.project.noMatch', { name: p.name }),
        }))}
      />
    </header>
  );
}
