import type { Project } from '../config';
import { errorsAt, type Issue } from './draft';

interface Props {
  project: Project;
  basePath: string;
  issues: Issue[];
  onDeleteEntry: (domain: string, key: string) => void;
  onDeleteDomain: (domain: string) => void;
}

export function SiteMappings({ project, basePath, issues, onDeleteEntry, onDeleteDomain }: Props) {
  const domains = Object.entries(project.siteMappings);
  const labelOf = (key: string) => project.fields.find((f) => f.key === key)?.label;
  return (
    <section aria-labelledby="mappings-h">
      <h3 id="mappings-h">Site mappings</h3>
      <p className="hint">CSS selectors picked per domain. Mappings are created on the page itself, not here.</p>
      {domains.length === 0 && <p>No site mappings.</p>}
      {domains.map(([domain, map]) => (
        <section key={domain} aria-label={`Site mappings for ${domain}`}>
          <h4>{domain}</h4>
          <ul>
            {Object.entries(map).map(([key, selector]) => {
              const errors = errorsAt(issues, `${basePath}.siteMappings.${domain}.${key}`);
              return (
                <li key={key}>
                  <span>
                    {labelOf(key) ?? key} ({key}): <code>{selector}</code>
                  </span>{' '}
                  <button type="button" aria-label={`Delete mapping ${key} for ${domain}`} onClick={() => onDeleteEntry(domain, key)}>
                    Delete mapping
                  </button>
                  {errors.length > 0 && <span className="error"> {errors.join('; ')}</span>}
                </li>
              );
            })}
          </ul>
          <button type="button" aria-label={`Delete all mappings for ${domain}`} onClick={() => onDeleteDomain(domain)}>
            Delete all for this domain
          </button>
        </section>
      ))}
    </section>
  );
}
