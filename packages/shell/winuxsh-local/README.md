# @cmx666/dsh-winuxsh-local

English | [中文](README.zh.md)

Local Winuxsh Service Provider for the `@deepseek-ai/dsh-shell` executor seam over the [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) service: `WinuxshLocalExecutor` spawns `<winuxsh> -c <command>` per call as a managed process through `ctx.subprocess`. It inherits the entire PowerShell executor family's process mechanics from [`@deepseek-ai/dsh-pwsh-local`](../pwsh-local/) — executable resolution, command defaulting and caps, timeout/cancel classification, the model-friendly terminal environment, and the model-facing stdout/stderr merge for background reads. Group mechanics (bounded spill-backed output, credential scrub, kill escalation, disposal) are the subprocess service's.

Winuxsh is a Windows-native shell with a bash-compatible `-c` command domain: the command string rides as ONE argv element and winuxsh parses the text itself, so no intermediate shell exists and there is no shell-quoting layer to escape. Native Win32 paths (`C:\...`) pass through unchanged.

The package root exports the default and named `WinuxshLocalExecutor` plugin, its `Config`, and the pure `resolveWinuxshPath`/`candidateWinuxshPaths` helpers.

## Config

```yaml
- id: bash
  name: '@cmx666/dsh-winuxsh-local'
  config:
    cwd: C:\path\to\workspace   # default: process.cwd()
    timeoutMs: 120000           # default foreground timeout
    maxTimeoutMs: 600000        # cap for per-call overrides
    maxOutputBytes: 64000       # per-stream in-memory cap; overflow spills to disk
    maxSpillBytes: 67108864     # per-stream full-output spill cap
    graceMs: 3000               # kill escalation and post-exit pipe-drain grace
    winuxshPath: C:\tools\winuxsh.exe  # explicit executable; else first PATH entry, then PATH resolution
```

## Behavior

The winuxsh twin of `dsh-pwsh-local`, inheriting its semantics call-for-call:

- **Spawn per call, no shell state** — every call is a fresh non-interactive `winuxsh -c` (deterministic; no profile files). The `-c` argument makes the command string the shell's entire input, so no startup banner, profile, or prompt can garble tool output.
- **The composition entry is a layer, not the last word** — when a settings provider is composed, this executor registers the capability's [`bash` namespace](../shell/README.md) with the entry above as its base, so a user section in `settings.yaml` layers over it and the next command runs with the new budgets. The namespace is shared with the PowerShell family because a host composes exactly one provider of `ctx.shell`; a document written on either platform keeps resolving on the other. Values the schema cannot judge (positive and finite, the `graceMs` timer bound) are refused at the write, leaving the running executor on its last good section.
- **Executable resolution** — `resolveWinuxshPath` prefers an explicit `winuxshPath`, then probes every PATH entry for `winuxsh[.exe]` (surrounding quotes stripped) with an lstat probe that accepts a real file or a link-shaped reparse point (a Windows app execution alias stat-fails against its target's ACL, but lstat sees the alias itself); otherwise it falls back to a bare `winuxsh` resolved through PATH (CreateProcess applies PATHEXT, so a `.cmd`/`.bat` shim on PATH still works). Resolution is a pure function of `(configured, env, platform)`; it runs at construction and again only when a stored `winuxshPath` differs from the one the current executable was resolved from, so an unrelated settings change never re-probes the filesystem.
- **Configured budgets over managed groups** — `resolve()` fills `workdir`/`timeoutMs`/`stdoutMaxBytes` from config, and every spawn hands the service explicit byte caps, spill cap, and `graceMs`. The grace must be positive, finite, and no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), so Node can represent it with one timer. Tree termination, the post-exit pipe-drain grace, tail-keep truncation, and bounded spill files are [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) mechanics. A foreground `ShellExecRequest.stdoutMaxBytes` can raise stdout's capture budget for one trusted caller; stderr and background runs still use `maxOutputBytes`.
- **Timeout and cancel classification** — `run()` fuses its config-clamped timeout with the caller's signal through one deadline; only the executor's own timeout reports `timedOut`, an upstream cancel reports `aborted`, and a self-terminated command reports neither ([timeout-library Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)). Windows reports forced termination as exit 1 without a signal, so signal-stamped facts (`signal`, `killed` status) are POSIX-only there; the timeout/abort classification is platform-independent.
- **Model-friendly terminal env** — the pwsh twin's `NO_COLOR=1 PAGER=cat GIT_PAGER=cat` plus `TERM=dumb` (winuxsh is a bash-compatible dialect, so the POSIX terminal marker applies, unlike pwsh) merged as ordinary env under the service's credential scrub and `DSH_*` channel rules; an explicit caller entry still wins.
- **Background processes** — `start()` returns a live `ShellProcess` handle immediately, no timeout applies, and the handle's `readOutput()` merges the service's offset-based stdout/stderr reads into one marked-section delta with a consuming cursor. A still-running process belongs to the subprocess service, so it survives executor reloads and dies (killed and joined) with the service's disposal. Everything task-shaped (ids, ownership, polling, notices) lives in the generic [`ctx.jobs` runtime](../../jobs/jobs/README.md), which the tool layer registers the handle with — this executor never sees a session or a registry.

## Model Experience

Indirectly, through `dsh-tool-bash`, which renders this executor's bounded stdout/stderr tails, background-process deltas (through the generic job runtime), spill-file paths, and infrastructure failures.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Unconfined by itself** — this executor always runs commands with the harness process's authority; deployments needing confinement compose a sandboxing executor or policy instead.
- **No persistent shell or PTY** — every call starts a fresh `winuxsh -c`.
- **The command string is winuxsh text** — the `-c` domain has no shell-quoting layer, but a model-facing command is parsed by winuxsh itself, so winuxsh syntax errors are command failures, not launch failures.
- **A background spawn-failure note is single-delivery** — the subprocess service buffers no output for a process that never ran, so the executor injects `spawn failed: …` into exactly one `readOutput()` delta; a reader that discards that delta cannot recover it.
- **Windows termination reports no signal** — a force-killed process settles as exit 1 with `signal: null`, so signal-based status classification (POSIX `killed`) does not apply on Windows; `kill()`-initiated stops still stamp `killed` directly.
- **Output line endings follow the host** — winuxsh writes CRLF on Windows and LF on POSIX, so callers comparing exact output text must normalize line endings (the suites do).

Scrub-heuristic and spill-retention caveats live with [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md), which owns those mechanics.
