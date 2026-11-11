import { useId, useMemo } from 'react';
import { useI18n } from '../settings';
import { buildPayload } from '../send/payload';
import { HELP_SECTIONS, PAYLOAD_KEYS, type HelpBlock } from './helpContent';

/** Built by the real payload builder so the example cannot drift from what is sent; same values as docs/webhook.md. */
export const examplePayload = (): string =>
  JSON.stringify(
    buildPayload({
      project: { id: 'articles', name: 'Articles', fields: [{ key: 'title' }, { key: 'price' }] },
      target: { id: 'inbox', name: 'Inbox' },
      url: 'https://example.com/article',
      title: 'Article',
      values: { title: 'Article' },
      content: '# Article\n\nBody text.',
      contentFormat: 'markdown',
      note: '',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    }),
    null,
    2,
  );

export function HelpSection() {
  const { t } = useI18n();
  const id = useId();
  const example = useMemo(() => examplePayload(), []);
  const anchor = (section: string) => `${id}-${section}`;

  // The hash is the address of the view, so in-page links scroll and move focus instead of changing it.
  const jump = (section: string) => {
    const el = document.getElementById(anchor(section));
    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  };

  const block = (b: HelpBlock, i: number) => {
    switch (b.kind) {
      case 'p':
        return <p key={i}>{t(b.key)}</p>;
      case 'ul':
        return (
          <ul key={i}>
            {b.keys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        );
      case 'sub':
        return <h4 key={i}>{t(b.key)}</h4>;
      case 'example':
        return (
          <pre key={i} className="options-help-code" tabIndex={0}>
            <code>{example}</code>
          </pre>
        );
      case 'keys':
        return (
          <dl key={i} className="options-help-keys">
            {PAYLOAD_KEYS.map((k) => (
              <div key={k}>
                <dt><code>{k}</code></dt>
                <dd>{t(`help.payload.k.${k}`)}</dd>
              </div>
            ))}
          </dl>
        );
    }
  };

  return (
    <article aria-labelledby={`${id}-title`} className="options-help">
      <h2 id={`${id}-title`}>{t('help.title')}</h2>
      <p>{t('help.intro')}</p>
      <nav aria-label={t('help.jump')} className="options-help-jump">
        <p className="options-nav-title" aria-hidden="true">{t('help.jump')}</p>
        <ul>
          {HELP_SECTIONS.map((s) => (
            <li key={s.id}>
              <button type="button" className="options-help-link" onClick={() => jump(s.id)}>
                {t(s.title)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {HELP_SECTIONS.map((s) => (
        <section key={s.id} aria-labelledby={anchor(s.id)} className="options-section">
          <h3 id={anchor(s.id)} tabIndex={-1}>{t(s.title)}</h3>
          {s.blocks.map(block)}
        </section>
      ))}
    </article>
  );
}
