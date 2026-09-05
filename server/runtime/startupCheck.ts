/** Explicit CLI-only image checks; normal startup has no environment/HTTP switch. */
export function startupCheckMode(argv: readonly string[]): 'exit' | 'http' | null {
  if (argv.includes('--check-startup')) return 'exit';
  if (argv.includes('--check-startup-http')) return 'http';
  return null;
}
