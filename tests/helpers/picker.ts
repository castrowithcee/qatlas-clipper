import type { StorageArea } from '../../src/config';

export function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const field = (key: string) => ({ key, label: key, required: false, sources: {} });
export const config = () => ({
  schemaVersion: 1,
  projects: [
    {
      id: 'articles',
      name: 'Articles',
      scope: { allSites: true, domains: [] },
      fields: [{ ...field('title'), label: 'Article title' }, field('price')],
      siteMappings: { 'example.com': { title: '.old', price: '.p' }, 'example.org': { title: 'h2' } },
      targets: [],
    },
    { id: 'other', name: 'Other', scope: { allSites: true, domains: [] }, fields: [field('title')], siteMappings: {}, targets: [] },
  ],
});
