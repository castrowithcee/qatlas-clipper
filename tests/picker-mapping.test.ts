import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { normalizeDomain, saveMapping } from '../src/picker/mapping';
import { config, fakeStorage } from './helpers/picker';

describe('normalizeDomain', () => {
  it('lowercases, strips one www. and the port', () => {
    expect(normalizeDomain('https://WWW.Example.com:8080/a')).toBe('example.com');
    expect(normalizeDomain('http://www.www.example.com/')).toBe('www.example.com');
    expect(normalizeDomain('https://shop.example.com/')).toBe('shop.example.com');
  });
  it('rejects non-http(s) and invalid URLs', () => {
    for (const u of ['file:///tmp/a.html', 'chrome://extensions', 'about:blank', 'nonsense']) {
      expect(() => normalizeDomain(u)).toThrow(ConfigError);
    }
  });
});

describe('saveMapping', () => {
  const base = { projectId: 'articles', fieldKey: 'title', pageUrl: 'https://www.example.com/x', selector: 'h1.new' };

  it('overwrites the same field and keeps other mappings and domains', async () => {
    const s = fakeStorage({ config: config() });
    await saveMapping(base, s);
    const p = (await loadConfig(s)).projects[0]!;
    expect(p.siteMappings['example.com']).toEqual({ title: 'h1.new', price: '.p' });
    expect(p.siteMappings['example.org']).toEqual({ title: 'h2' });
  });
  it('creates a new domain entry', async () => {
    const s = fakeStorage({ config: config() });
    await saveMapping({ ...base, pageUrl: 'https://example.net/' }, s);
    const cfg = await loadConfig(s);
    expect(cfg.projects[0]!.siteMappings['example.net']).toEqual({ title: 'h1.new' });
    expect(cfg.projects[1]!.siteMappings).toEqual({});
  });
  it('rejects unknown project, unknown field and non-http pages without writing', async () => {
    const s = fakeStorage({ config: config() });
    const before = structuredClone(s.data);
    await expect(saveMapping({ ...base, projectId: 'nope' }, s)).rejects.toThrow(ConfigError);
    await expect(saveMapping({ ...base, fieldKey: 'nope' }, s)).rejects.toThrow(ConfigError);
    await expect(saveMapping({ ...base, pageUrl: 'file:///a' }, s)).rejects.toThrow(ConfigError);
    expect(s.data).toEqual(before);
  });
});
