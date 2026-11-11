const FALLBACK = 'qatlas-clipper-share';

/** A neutral, file-system safe name for a share file: letters and digits only, always with the product prefix, ending in .json. */
export function shareFilename(name?: string): string {
  const slug = (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug ? `qatlas-clipper-${slug}` : FALLBACK}.json`;
}
