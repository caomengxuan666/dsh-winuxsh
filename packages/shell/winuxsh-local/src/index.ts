/**
 * Local Winuxsh Service Provider for the bash capability seam. Each command
 * runs as `<winuxsh> -c <command>` in a managed process spawned through
 * `ctx.subprocess`, with the PowerShell executor family's process lifecycle,
 * output collection, deadlines, cause classification, and model-friendly
 * environment inherited from `@deepseek-ai/dsh-pwsh-local`. Winuxsh is a
 * Windows-native shell with a bash-compatible `-c` command domain: the
 * command string is passed as ONE argv element and winuxsh parses the text
 * itself, so no intermediate shell exists and there is no shell-quoting layer
 * to escape (the `bash -c` string domain applies as-is).
 *
 * @module @deepseek-ai/dsh-winuxsh-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ENV_OVERRIDES, PwshLocalExecutor, assertServiceablePwshConfig } from '@deepseek-ai/dsh-pwsh-local'
import type { Config as PwshConfig, ResolvedConfig } from '@deepseek-ai/dsh-pwsh-local'
import type { ShellExecSpec } from '@deepseek-ai/dsh-shell'
import { resolveWinuxshPath } from './resolve.ts'

/* jscpd:ignore-start -- the executor mirrors the pwsh twin call-for-call by
   design (inheriting its mechanics), so the schema and constants match */
/** Default SIGTERM→SIGKILL grace period (the `graceMs` config). */
const DEFAULT_GRACE_MS = 3_000

/** Default per-stream spill cap (the `maxSpillBytes` config). */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /**
   * Explicit winuxsh executable. When omitted, PATH entries are probed in
   * order for `winuxsh[.exe]`, falling back to a bare `winuxsh` resolved
   * through PATH.
   */
  winuxshPath?: string
}

/** The shape after schemastery applied the defaults (cwd/winuxshPath have none). */
export type ResolvedWinuxshConfig = Required<Omit<Config, 'cwd' | 'winuxshPath'>> & Pick<Config, 'cwd' | 'winuxshPath'>
/* jscpd:ignore-end */

// Resolution lives in its own dependency-free module so the repository's
// coverage-gate probe shares the exact definition the suites use.
export { candidateWinuxshPaths, resolveWinuxshPath } from './resolve.ts'

/**
 * Local Winuxsh executor over `ctx.subprocess` — the winuxsh twin of
 * `PwshLocalExecutor`. All process mechanics (bounded spill-backed output,
 * deadlines, kill escalation, background handles) are inherited; this
 * subclass supplies the winuxsh executable resolution, the `-c` argv, the
 * bash-like model-friendly environment, and winuxsh-branded diagnostics.
 */
export class WinuxshLocalExecutor extends PwshLocalExecutor {
  /* jscpd:ignore-start -- schema mirrors the pwsh/bash executor family */
  static override Config: z<Config> = z.object({
    cwd: z.string(),
    timeoutMs: z.number().default(120_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(64_000),
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES),
    graceMs: z.number().default(DEFAULT_GRACE_MS),
    winuxshPath: z.string(),
  })
  /* jscpd:ignore-end */

  constructor(ctx: Context, config: Config) {
    // The base constructor reads the pwsh-shaped section through the virtual
    // declaredExecutable()/resolveExecutable()/assertServiceable() hooks, so
    // the cast only reconciles the differing optional config-key names.
    super(ctx, config as unknown as PwshConfig)
  }

  /** Winuxsh-branded diagnostics from the inherited executor mechanics. */
  protected override readonly diagnosticPrefix = 'winuxsh-local'

  /** Reject the resolved section with winuxsh-branded messages. */
  protected override assertServiceable(config: PwshConfig): void {
    // Literal prefix, not the diagnosticPrefix field: the base constructor
    // runs this hook before this subclass's field initializers execute.
    assertServiceablePwshConfig(config, 'winuxsh-local')
  }

  /** The declared executable from the winuxsh-shaped resolved section. */
  protected override declaredExecutable(config: ResolvedConfig): string | undefined {
    return (config as unknown as ResolvedWinuxshConfig).winuxshPath
  }

  /** Resolve the declared winuxsh executable, or discover it through PATH. */
  protected override resolveExecutable(declared: string | undefined): string {
    return resolveWinuxshPath(declared)
  }

  /** The winuxsh executable every command runs through. */
  get winuxshPath(): string {
    return this.pwshPath
  }

  /** Model-friendly env for the bash-compatible winuxsh dialect. */
  protected override envOverrides(): Readonly<Record<string, string>> {
    return { ...ENV_OVERRIDES, TERM: 'dumb' }
  }

  /**
   * The winuxsh invocation argv for one resolved spec — the argv-level seam a
   * confining subclass wraps through `ctx.sandbox.confine` (the winuxsh twin
   * of `dsh-pwsh-local`'s argv hook; see `@deepseek-ai/dsh-winuxsh-sandbox`).
   */
  protected override argv(spec: ShellExecSpec): string[] {
    return [this.winuxshPath, '-c', spec.command]
  }
}

export default WinuxshLocalExecutor
