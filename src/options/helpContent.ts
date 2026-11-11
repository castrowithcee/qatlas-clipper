import type { MessageKey } from '../i18n';

/** Blocks of a help section; paragraphs and list items are separate catalog keys, never markup. */
export type HelpBlock =
  | { kind: 'p'; key: MessageKey }
  | { kind: 'ul'; keys: MessageKey[] }
  | { kind: 'example' }
  | { kind: 'keys' }
  | { kind: 'sub'; key: MessageKey };

export interface HelpSectionDef {
  id: string;
  title: MessageKey;
  blocks: HelpBlock[];
}

const p = (key: MessageKey): HelpBlock => ({ kind: 'p', key });
const ul = (...keys: MessageKey[]): HelpBlock => ({ kind: 'ul', keys });

/** Order of the sections is the reading order and the order of the jump list. */
export const HELP_SECTIONS: HelpSectionDef[] = [
  { id: 'project', title: 'help.project.title', blocks: [p('help.project.p1'), p('help.project.p2'), p('help.project.p3'), p('help.project.p4')] },
  { id: 'folders', title: 'help.folders.title', blocks: [p('help.folders.p1'), p('help.folders.p2'), p('help.folders.p3'), p('help.folders.p4')] },
  { id: 'tags', title: 'help.tags.title', blocks: [p('help.tags.p1'), p('help.tags.p2'), p('help.tags.p3'), p('help.tags.p4'), p('help.tags.p5')] },
  {
    id: 'fields',
    title: 'help.fields.title',
    blocks: [p('help.fields.p1'), ul('help.fields.li1', 'help.fields.li2', 'help.fields.li3'), p('help.fields.p2'), p('help.fields.p3'), p('help.fields.p4')],
  },
  { id: 'click', title: 'help.click.title', blocks: [p('help.click.p1'), p('help.click.p2'), p('help.click.p3'), p('help.click.p4'), p('help.click.p5')] },
  {
    id: 'formats',
    title: 'help.formats.title',
    blocks: [p('help.formats.p1'), ul('help.formats.li1', 'help.formats.li2', 'help.formats.li3'), p('help.formats.p2'), p('help.formats.p3')],
  },
  {
    id: 'fixed',
    title: 'help.fixed.title',
    blocks: [p('help.fixed.p1'), ul('help.fixed.li1', 'help.fixed.li2', 'help.fixed.li3', 'help.fixed.li4'), p('help.fixed.p2')],
  },
  { id: 'targets', title: 'help.targets.title', blocks: [p('help.targets.p1'), ul('help.targets.li1', 'help.targets.li2', 'help.targets.li3')] },
  {
    id: 'payload',
    title: 'help.payload.title',
    blocks: [
      p('help.payload.p1'),
      { kind: 'sub', key: 'help.payload.example' },
      { kind: 'example' },
      { kind: 'sub', key: 'help.payload.keys' },
      { kind: 'keys' },
      { kind: 'sub', key: 'help.response.title' },
      p('help.response.p1'),
      p('help.response.p2'),
      p('help.response.p3'),
    ],
  },
  { id: 'openAs', title: 'help.openAs.title', blocks: [p('help.openAs.p1'), p('help.openAs.p2'), p('help.openAs.p3'), p('help.openAs.p4')] },
  { id: 'io', title: 'help.io.title', blocks: [p('help.io.p1'), p('help.io.p2'), p('help.io.p3'), p('help.io.p4'), p('help.io.p5')] },
];

/** Keys of the sent object in documentation order; each has a description under `help.payload.k.<key>`. */
export const PAYLOAD_KEYS = ['project', 'target', 'url', 'title', 'domain', 'fields', 'content', 'content_format', 'note', 'captured_at', 'version'] as const;
