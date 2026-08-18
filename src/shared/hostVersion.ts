/**
 * Pure semver logic for comparing a plugin version (minHostVersion)
 * against the CanvasTTY host version. Extracted into a separate module
 * so it can be unit-tested with node --test.
 */

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Returns true when the string is a valid semver. */
export function isValidSemver(value: unknown): value is string {
  return typeof value === "string" && SEMVER_RE.test(value.trim());
}

/** Parses semver into [major, minor, patch]; invalid input yields null. */
function parseSemver(value: string): [number, number, number] | null {
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compares two semver values. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b.
 * Invalid semver is treated as 0.0.0 (does not block legacy installs).
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a) ?? [0, 0, 0];
  const pb = parseSemver(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/**
 * Whether the plugin satisfies the host version: minHostVersion absent (legacy)
 * or minHostVersion <= hostVersion.
 */
export function satisfiesHostVersion(minHostVersion: string | undefined, hostVersion: string): boolean {
  if (!minHostVersion) return true;
  if (!isValidSemver(minHostVersion) || !isValidSemver(hostVersion)) return true;
  return compareSemver(minHostVersion, hostVersion) <= 0;
}
