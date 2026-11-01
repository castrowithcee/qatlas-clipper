import { IconButton, Select, Tooltip } from '../ui/components';
import { useI18n } from '../settings';

interface Props {
  title: string;
  url: string;
  projects: { id: string; name: string }[];
  matchingIds: string[];
  value: string;
  onChange: (id: string) => void;
  onOpenOptions: () => void;
}

/** Host name for display; falls back to the raw text for URLs that cannot be parsed. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** Page title and domain are cut by CSS (ellipsis) and stay complete in the DOM. */
export function Header({ title, url, projects, matchingIds, value, onChange, onOpenOptions }: Props) {
  const { t } = useI18n();
  const domain = domainOf(url);
  return (
    <header className="popup-header">
      <div className="popup-header-top">
        <div className="popup-page">
          {title && <p className="popup-title" title={title}>{title}</p>}
          <p className="popup-domain" title={url}>{domain}</p>
        </div>
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
