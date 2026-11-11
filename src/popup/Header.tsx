import { useState } from 'react';
import { Combobox, IconButton, type ComboboxGroup } from '../ui/components';
import { sortByLabel } from '../config';
import { useI18n, useSettings } from '../settings';

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
  const { settings, language } = useSettings();
  const [text, setText] = useState('');
  const needle = text.trim().toLowerCase();
  const known = new Map(folders.map((f) => [f.id, f.name]));
  type Entry = (typeof projects)[number];
  const tagNames = (p: Entry) => tags.filter((x) => p.tagIds?.includes(x.id)).map((x) => x.name);
  const named = (p: Entry) => {
    const own = tagNames(p);
    return own.length > 0 ? t('popup.project.withTags', { name: p.name, tags: own.join(', ') }) : p.name;
  };
  const folderOf = (p: Entry) => (p.folderId ? known.get(p.folderId) : undefined);
  const fits = (p: Entry) =>
    needle === '' || [p.name, folderOf(p) ?? '', ...tagNames(p)].some((n) => n.toLowerCase().includes(needle));
  const toOption = (p: Entry) => ({ value: p.id, label: named(p) });
  // The device sort only changes the display order; `projects` and `matchingIds` keep the manual order.
  const byName = <T extends { name: string }>(items: T[]) => sortByLabel(items, settings.projectSort, language, (x) => x.name);
  const visible = projects.filter(fits);
  const rest = visible.filter((p) => !matchingIds.includes(p.id));
  const sections: ComboboxGroup[] = [
    { id: 'matching', label: t('popup.project.matching'), options: byName(visible.filter((p) => matchingIds.includes(p.id))).map(toOption) },
    { id: 'loose', label: t('popup.project.noFolder'), options: byName(rest.filter((p) => !folderOf(p))).map(toOption) },
    ...byName(folders).map((f): ComboboxGroup => ({ id: `f-${f.id}`, label: f.name, icon: 'folder', options: byName(rest.filter((p) => p.folderId === f.id)).map(toOption) })),
  ].filter((g) => g.options.length > 0);
  // A single unlabeled section needs no heading.
  const groups = sections.length === 1 && !sections[0]!.icon ? [{ ...sections[0]!, label: undefined }] : sections;
  const selected = projects.find((p) => p.id === value);
  return (
    <header className="popup-header">
      <div className="popup-header-top">
        <IconButton icon={highlight ? 'eye' : 'eye-off'} label={t('popup.header.highlight')} aria-pressed={highlight} onClick={onToggleHighlight} />
        {switchTo && (
          <IconButton icon={switchTo} label={t(switchTo === 'sidepanel' ? 'popup.header.toSidepanel' : 'popup.header.toPopup')} onClick={onSwitchView} />
        )}
        <IconButton icon="settings" label={t('popup.header.options')} onClick={onOpenOptions} />
      </div>
      <Combobox
        label={t('popup.project.label')}
        text={text}
        onTextChange={setText}
        groups={groups}
        listLabel={t('popup.project.list')}
        emptyText={t('popup.project.empty')}
        noResultsText={t('popup.project.noResults')}
        selectedValue={value}
        closedText={selected ? named(selected) : ''}
        icon="project"
        autoActivate
        onSelect={(id) => {
          setText('');
          if (id !== value) onChange(id);
        }}
        onCancel={() => setText('')}
      />
    </header>
  );
}
