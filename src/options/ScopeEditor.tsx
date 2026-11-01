import type { Scope } from '../config';
import { errorsAt, setAllSites, type Issue } from './draft';
import { SelectInput, TextInput } from './fields';

interface Props {
  scope: Scope;
  basePath: string;
  issues: Issue[];
  onChange: (scope: Scope) => void;
}

export function ScopeEditor({ scope, basePath, issues, onChange }: Props) {
  const path = `${basePath}.scope`;
  const setDomain = (i: number, v: string) => onChange({ ...scope, domains: scope.domains.map((d, j) => (j === i ? v : d)) });
  return (
    <section aria-labelledby="scope-h">
      <h3 id="scope-h">Scope</h3>
      <p className="hint">Where the project applies. A matching project is listed first and preselected in the popup.</p>
      <SelectInput
        label="Applies to"
        value={scope.allSites ? 'all' : 'domains'}
        options={[
          ['all', 'All sites'],
          ['domains', 'Domains'],
        ]}
        onChange={(v) => onChange(setAllSites(scope, v === 'all'))}
      />
      {!scope.allSites && (
        <fieldset>
          <legend>Domains</legend>
          <p className="hint">A domain also covers its subdomains, e.g. example.com covers jobs.example.com.</p>
          {scope.domains.map((d, i) => (
            <div key={i} className="row inline">
              <TextInput label={`Domain ${i + 1}`} value={d} errors={errorsAt(issues, `${path}.domains[${i}]`)} onChange={(v) => setDomain(i, v)} />
              <button
                type="button"
                aria-label={`Remove domain ${i + 1}`}
                onClick={() => onChange({ ...scope, domains: scope.domains.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          {errorsAt(issues, `${path}.domains`).length > 0 && <p className="error">{errorsAt(issues, `${path}.domains`).join('; ')}</p>}
          <button type="button" onClick={() => onChange({ ...scope, domains: [...scope.domains, ''] })}>
            Add domain
          </button>
        </fieldset>
      )}
      <TextInput
        label="Page type"
        hint="Optional schema.org type, e.g. Product. The page must carry it in its JSON-LD."
        value={scope.pageType ?? ''}
        errors={errorsAt(issues, `${path}.pageType`)}
        onChange={(v) => onChange({ ...scope, pageType: v })}
      />
    </section>
  );
}
