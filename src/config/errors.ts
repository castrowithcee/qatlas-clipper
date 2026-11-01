/** Error with human-readable issues. Messages never contain header values. */
export class ConfigError extends Error {
  readonly issues: string[];
  constructor(summary: string, issues: string[] = []) {
    super(issues.length > 0 ? `${summary}:\n${issues.map((i) => `- ${i}`).join('\n')}` : summary);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}
