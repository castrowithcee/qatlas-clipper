import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe Markdown renderer for untrusted values. Output is built only from React elements and text nodes
 * (never HTML), links are shown as "text (url)" and never become anchors. Unsupported syntax stays literal text.
 */

// Bounds keep pathological input (e.g. long runs of `*`) from becoming quadratic or deeply nested.
const MAX_SPAN = 2000;
const MAX_DEPTH = 4;

const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

function findClose(s: string, from: number, delim: string): number {
  const end = Math.min(s.length, from + MAX_SPAN);
  for (let j = from; j < end; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s.startsWith(delim, j) && !isSpace(s[j - 1]) && j > from) {
      // A single delimiter must not be the start of a double one.
      if (delim.length === 1 && s[j + 1] === delim) { j++; continue; }
      if (delim === '_' || delim === '__') { if (isWord(s[j + delim.length])) continue; }
      return j;
    }
  }
  return -1;
}

function inline(s: string, depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!<>~|]/.test(s.charAt(i + 1))) {
      buf += s.charAt(i + 1); i += 2; continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1 && end - i <= MAX_SPAN) {
        flush(); out.push(<code key={out.length}>{s.slice(i + 1, end)}</code>); i = end + 1; continue;
      }
    }
    if (c === '[') {
      const lim = Math.min(s.length, i + MAX_SPAN);
      const close = s.indexOf('](', i + 1);
      const paren = close > 0 && close < lim ? s.indexOf(')', close + 2) : -1;
      if (paren > 0 && paren < lim && !s.slice(i + 1, close).includes('[')) {
        const label = s.slice(i + 1, close);
        const url = s.slice(close + 2, paren).trim();
        flush();
        out.push(<Fragment key={out.length}>{depth < MAX_DEPTH ? inline(label, depth + 1) : label}{url ? ` (${url})` : ''}</Fragment>);
        i = paren + 1; continue;
      }
    }
    if ((c === '*' || c === '_') && depth < MAX_DEPTH) {
      const delim = s.charAt(i + 1) === c ? c + c : c;
      const after = s[i + delim.length];
      const canOpen = !isSpace(after) && after !== c && (c === '*' || !isWord(s[i - 1]));
      if (canOpen) {
        const j = findClose(s, i + delim.length, delim);
        if (j > 0) {
          flush();
          const kids = inline(s.slice(i + delim.length, j), depth + 1);
          out.push(delim.length === 2 ? <strong key={out.length}>{kids}</strong> : <em key={out.length}>{kids}</em>);
          i = j + delim.length; continue;
        }
      }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^[ \t]*([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const kids: ReactNode[] = [];
    para.forEach((l, n) => {
      if (n) kids.push(<br key={`br${n}`} />);
      kids.push(<Fragment key={n}>{inline(l, 0)}</Fragment>);
    });
    out.push(<p key={out.length}>{kids}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((t, n) => <li key={n}>{inline(t, 0)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };

  for (const line of lines) {
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = HEADING.exec(line);
    if (h) {
      flushPara(); flushList();
      const Tag = `h${(h[1] ?? '#').length}` as 'h1';
      out.push(<Tag key={out.length}>{inline(h[2] ?? '', 0)}</Tag>);
      continue;
    }
    const m = ITEM.exec(line);
    if (m) {
      flushPara();
      const ordered = /\d/.test(m[1] ?? '');
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(m[2] ?? '');
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out;
}

export function MarkdownView({ source }: { source: string }) {
  return <div className="q-markdown">{blocks(source)}</div>;
}
