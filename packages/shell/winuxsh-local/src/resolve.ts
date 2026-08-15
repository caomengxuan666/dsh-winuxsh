/**
 * Winuxsh executable resolution, dependency-free so non-package consumers
 * (the repository's coverage-gate probe in `vitest.config.ts`) can share the
 * ONE resolution definition with the executor and its suites — a probe that
 * resolved differently from the code under test could exempt a file whose
 * suites actually run.
 *
 * Winuxsh has no well-known install locations: the default discovery probes
 * PATH entries for `winuxsh[.exe]` and otherwise falls back to a bare
 * `winuxsh` that the operating system resolves through PATH (CreateProcess on
 * Windows applies PATHEXT, so a `.cmd`/`.bat` shim on PATH still works).
 *
 * @module @deepseek-ai/dsh-winuxsh-local/resolve
 */

import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PATH-derived winuxsh executable candidates, platform-named. Explicitly
 * parameterized (env, platform) so resolution is a pure function of its
 * inputs on every platform.
 * @param env - the environment to probe; defaults to the process environment.
 * @param platform - the platform to resolve for; defaults to the process platform.
 * @returns candidate `winuxsh` executable paths in resolution order.
 */
export function candidateWinuxshPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const executable = platform === 'win32' ? 'winuxsh.exe' : 'winuxsh'
  const delimiter = platform === 'win32' ? ';' : ':'
  const candidates: string[] = []
  // PATH entries may carry surrounding quotes from `setx`-style definitions.
  for (const entry of (env.PATH ?? '').split(delimiter)) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    candidates.push(join(trimmed, executable))
  }
  return candidates
}

/**
 * Whether a candidate can be spawned. lstat opens the entry itself instead of
 * following reparse points, so it sees a Windows app execution alias where
 * stat hits the target's ACL (EACCES); Node reports that alias as a symlink
 * on current releases and as a plain file on older ones, and CreateProcess
 * resolves either shape. A real directory never matches.
 */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    // ENOENT (the candidate vanished between listing and probing) is the only
    // expected failure; any other error names an unspawnable path, so false
    // is the safe answer for it too.
    return false
  }
}

/**
 * Resolve the winuxsh executable this executor spawns.
 * @param configured - an explicit `winuxshPath` config value, trusted as-is.
 * @param env - the environment to probe; defaults to the process environment.
 * @param platform - the platform to resolve for; defaults to the process platform.
 * @returns the configured path verbatim, else the first existing PATH
 * candidate, else a bare `winuxsh` for PATH resolution.
 */
export function resolveWinuxshPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  for (const candidate of candidateWinuxshPaths(env, platform)) {
    if (candidateExists(candidate)) return candidate
  }
  return 'winuxsh'
}
