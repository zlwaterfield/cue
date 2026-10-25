/**
 * Settings → Report an Issue opens a new GitHub issue from `.github/ISSUE_TEMPLATE/report.yml`,
 * with the app and version already filled in.
 */
export function reportIssueUrl(app: string): string {
  return `https://github.com/zlwaterfield/cue/issues/new?template=report.yml&app=${encodeURIComponent(app)}`
}
