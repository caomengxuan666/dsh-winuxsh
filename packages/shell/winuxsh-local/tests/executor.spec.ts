/**
 * Real-process tests for `@deepseek-ai/dsh-winuxsh-local`: the LOCAL subprocess
 * service plus a REAL winuxsh executable, exercised through the executor seam
 * (`resolve` → `run`/`start`). These verify the world — actual winuxsh runs,
 * output capture, deadlines, and the background-handle contract. The suite
 * self-skips when no usable `winuxsh` resolves (the binary is internal); the
 * pure unit tests (config validation, executable resolution, argv
 * construction) run on every platform.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WinuxshLocalExecutor, candidateWinuxshPaths, resolveWinuxshPath } from '@deepseek-ai/dsh-winuxsh-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { ShellProcess } from '@deepseek-ai/dsh-shell'

// The probe follows the executor's own resolution (a PATH install is found
// even when bare `winuxsh` is not on PATH).
const hasWinuxsh = spawnSync(resolveWinuxshPath(), ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0

/** Normalize platform line endings (CRLF on Windows, LF elsewhere). */
const lf = (text: string): string => text.replace(/\r\n/g, '\n')

async function setup(config: ConstructorParameters<typeof WinuxshLocalExecutor>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(WinuxshLocalExecutor, { graceMs: 200, ...config })
  const shell = ctx.shell as WinuxshLocalExecutor
  return { ctx, shell }
}

describe('resolveWinuxshPath and candidateWinuxshPaths (pure, every platform)', () => {
  it('trusts an explicit configured path verbatim', () => {
    expect(resolveWinuxshPath('C:\\custom\\winuxsh.exe')).toBe('C:\\custom\\winuxsh.exe')
    expect(resolveWinuxshPath('winuxsh')).toBe('winuxsh')
  })

  it('falls through an empty configured path to PATH discovery', () => {
    expect(resolveWinuxshPath('', { PATH: 'P:\\Store' }, 'win32')).toBe('winuxsh')
  })

  it('names the executable by platform', () => {
    expect(candidateWinuxshPaths({ PATH: 'P:\\Store' }, 'win32')).toEqual([join('P:\\Store', 'winuxsh.exe')])
    expect(candidateWinuxshPaths({ PATH: '/usr/local/bin' }, 'linux')).toEqual([join('/usr/local/bin', 'winuxsh')])
    expect(candidateWinuxshPaths({ PATH: '/usr/local/bin' }, 'darwin')).toEqual([join('/usr/local/bin', 'winuxsh')])
  })

  it('splits PATH by the platform delimiter and strips surrounding quotes', () => {
    const win32 = candidateWinuxshPaths({ PATH: ';"Q:\\quoted store";' + ';' }, 'win32')
    expect(win32).toEqual([join('Q:\\quoted store', 'winuxsh.exe')])
    expect(candidateWinuxshPaths({}, 'win32')).toEqual([])
    const posix = candidateWinuxshPaths({ PATH: '"/opt/store":/usr/bin:' }, 'linux')
    expect(posix).toEqual([join('/opt/store', 'winuxsh'), join('/usr/bin', 'winuxsh')])
  })

  it('returns the first EXISTING PATH candidate, else winuxsh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-winuxsh-resolve-'))
    const store = join(dir, 'store')
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, 'winuxsh.exe'), '')
    expect(resolveWinuxshPath(undefined, { PATH: store }, 'win32')).toBe(join(store, 'winuxsh.exe'))
    expect(resolveWinuxshPath(undefined, { PATH: join(dir, 'empty') }, 'win32')).toBe('winuxsh')
    expect(resolveWinuxshPath(undefined, { PATH: store }, 'linux')).toBe('winuxsh')
  })

  it('accepts a link-shaped PATH candidate whose target cannot be stat-ed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-winuxsh-resolve-link-'))
    const store = join(dir, 'store')
    mkdirSync(store, { recursive: true })
    const link = join(store, 'winuxsh.exe')
    symlinkSync(join(dir, 'no-such-target.exe'), link)
    expect(resolveWinuxshPath(undefined, { PATH: store }, 'win32')).toBe(link)
  })

  it('skips a directory candidate and falls through to the PATH-resolution default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-winuxsh-resolve-dir-'))
    const store = join(dir, 'store')
    mkdirSync(join(store, 'winuxsh.exe'), { recursive: true })
    expect(resolveWinuxshPath(undefined, { PATH: store }, 'win32')).toBe('winuxsh')
  })
})

describe('config validation (pure, every platform)', () => {
  it('rejects invalid numeric config at construction', async () => {
    await expect(setup({ timeoutMs: Number.NaN })).rejects.toThrow(/winuxsh-local: timeoutMs/)
    await expect(setup({ maxTimeoutMs: 0 })).rejects.toThrow(/winuxsh-local: maxTimeoutMs/)
    await expect(setup({ maxOutputBytes: -1 })).rejects.toThrow(/winuxsh-local: maxOutputBytes/)
    await expect(setup({ maxSpillBytes: 0 })).rejects.toThrow(/winuxsh-local: maxSpillBytes/)
    await expect(setup({ graceMs: 0 })).rejects.toThrow(/winuxsh-local: graceMs/)
    await expect(setup({ graceMs: MAX_TIMER_DELAY_MS + 1 }))
      .rejects.toThrow(`winuxsh-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  })

  it('rejects invalid per-call overrides in resolve()', async () => {
    const { ctx, shell } = await setup()
    expect(() => shell.resolve({ command: 'echo ok', timeoutMs: Number.NaN })).toThrow(/winuxsh-local: request\.timeoutMs/)
    expect(() => shell.resolve({ command: 'echo ok', timeoutMs: -1 })).toThrow(/winuxsh-local: request\.timeoutMs/)
    expect(() => shell.resolve({ command: 'echo ok', stdoutMaxBytes: Number.NaN })).toThrow(/winuxsh-local: request\.stdoutMaxBytes/)
    expect(() => shell.resolve({ command: 'echo ok', stdoutMaxBytes: -1 })).toThrow(/winuxsh-local: request\.stdoutMaxBytes/)
    await ctx.fiber.dispose()
  })

  it('resolves defaults and caps without a real winuxsh', async () => {
    const { ctx, shell } = await setup({ timeoutMs: 1_000, maxTimeoutMs: 2_000 })
    const spec = shell.resolve({ command: 'echo ok', timeoutMs: 99_999 })
    expect(spec.timeoutMs).toBe(2_000)
    expect(spec.stdoutMaxBytes).toBe(64_000)
    expect(spec.workdir).toBe(process.cwd())
    await ctx.fiber.dispose()
  })
})

describe('spawn construction (pure, every platform)', () => {
  /** A subprocess service that records spawn specs and settles instantly. */
  class CapturingSubprocessRuntime extends SubprocessRuntime {
    specs: SubprocessSpawnSpec[] = []
    override async resolveExecutable(command: string): Promise<string> { return command }
    override spawnTerminal(): Promise<never> { throw new Error('winuxsh spawns pipes, never terminals') }
    private readonly reader: SubprocessOutputReader = {
      readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }),
    }
    override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      this.specs.push(spec)
      return {
        pid: -1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: { stdout: this.reader, stderr: this.reader },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate: () => {},
        waitForExit: async () => true,
      }
    }
  }

  it('runs every command as ONE argv element under `-c`', async () => {
    const ctx = new Context()
    const subprocess = new CapturingSubprocessRuntime(ctx)
    await ctx.plugin(WinuxshLocalExecutor)
    await ctx.shell.run(ctx.shell.resolve({ command: 'echo 你好' }))
    expect(subprocess.specs).toHaveLength(1)
    const { argv } = subprocess.specs[0]!
    expect(argv).toHaveLength(3)
    // argv[0] is the resolved executable: an existing PATH candidate's full
    // path when winuxsh is installed, else the bare `winuxsh` fallback.
    expect(argv[0]).toBe(resolveWinuxshPath())
    expect(argv[1]).toBe('-c')
    expect(argv[2]).toBe('echo 你好')
    await ctx.fiber.dispose()
  })

  it('uses the configured winuxshPath verbatim and threads the bash-like terminal env', async () => {
    const ctx = new Context()
    const subprocess = new CapturingSubprocessRuntime(ctx)
    await ctx.plugin(WinuxshLocalExecutor, { winuxshPath: 'C:\\tools\\winuxsh.exe' })
    await ctx.shell.run(ctx.shell.resolve({ command: 'echo ok' }))
    expect(subprocess.specs[0]!.argv[0]).toBe('C:\\tools\\winuxsh.exe')
    const env = subprocess.specs[0]!.env
    expect(env?.NO_COLOR).toBe('1')
    expect(env?.TERM).toBe('dumb')
    expect(env?.PAGER).toBe('cat')
    await ctx.fiber.dispose()
  })
})

describe.skipIf(!hasWinuxsh)('WinuxshLocalExecutor.run', () => {
  it('resolves with output and the effective timeout', { timeout: 15_000 }, async () => {
    const { shell } = await setup({ timeoutMs: 10_000 })
    const result = await shell.run(shell.resolve({ command: 'echo hi' }))
    expect(result.exitCode).toBe(0)
    expect(lf(result.stdout.text)).toBe('hi\n')
    expect(result.timeoutMs).toBe(10_000)
  })

  it('uses config cwd, overridable per call', async () => {
    const first = mkdtempSync(join(tmpdir(), 'dsh-winuxsh-cwd-a-'))
    const second = mkdtempSync(join(tmpdir(), 'dsh-winuxsh-cwd-b-'))
    const { shell } = await setup({ cwd: first })
    const fromConfig = await shell.run(shell.resolve({ command: 'pwd' }))
    expect(samePath(fromConfig.stdout.text.trim(), first)).toBe(true)
    const fromCall = await shell.run(shell.resolve({ command: 'pwd', workdir: second }))
    expect(samePath(fromCall.stdout.text.trim(), second)).toBe(true)
  })

  it('defaults cwd to process.cwd()', async () => {
    const { shell } = await setup()
    const result = await shell.run(shell.resolve({ command: 'pwd' }))
    expect(samePath(result.stdout.text.trim(), process.cwd())).toBe(true)
  })

  it('per-call timeout takes precedence under the cap and kills on expiry', async () => {
    const { shell } = await setup({ timeoutMs: 60_000 })
    const result = await shell.run(shell.resolve({ command: 'sleep 60', timeoutMs: 100 }))
    expect(result.timedOut).toBe(true)
    // Mutually exclusive: a timeout classifies as timedOut, never also aborted.
    expect(result.aborted).toBe(false)
    expect(result.timeoutMs).toBe(100)
  })

  it('propagates abort signals', async () => {
    const { shell } = await setup()
    const controller = new AbortController()
    const pending = shell.run(shell.resolve({ command: 'sleep 60', signal: controller.signal }))
    setTimeout(() => { controller.abort() }, 50)
    const result = await pending
    expect(result.aborted).toBe(true)
    // Mutually exclusive: an upstream cancel classifies as aborted, never also timedOut.
    expect(result.timedOut).toBe(false)
  })

  it('rejects on spawn failure (bad workdir)', async () => {
    const { shell } = await setup()
    await expect(shell.run(shell.resolve({ command: 'echo ok', workdir: '/nonexistent-dsh' }))).rejects.toThrow(/ENOENT/)
  })
})

describe.skipIf(!hasWinuxsh)('WinuxshLocalExecutor.start (background process handles)', () => {
  it('start returns immediately with a running handle that settles as completed', async () => {
    const { shell } = await setup()
    const before = Date.now()
    // The sleep outlasts any realistic spawn latency, so returning while the
    // child still sleeps proves start() does not wait for completion.
    const proc = shell.start(shell.resolve({ command: 'sleep 2; echo done' }))
    expect(Date.now() - before).toBeLessThan(1000)
    expect(proc.status).toBe('running')
    await proc.done
    expect(proc.status).toBe('completed')
    expect(proc.exitCode).toBe(0)
  })

  it('readOutput is consuming: increments are never re-delivered, and reads stay valid after exit', async () => {
    const { shell } = await setup()
    const proc = shell.start(shell.resolve({ command: 'echo first; sleep 1; echo second' }))
    const first = await readUntil(proc, 'first\n')
    expect(lf(first)).toBe('first\n')
    await proc.done
    // Read-after-exit returns the remaining buffered output — once.
    const second = proc.readOutput()
    expect(lf(second.delta)).toBe('second\n')
    expect(second.lossy).toBe(false)
    expect(proc.readOutput().delta).toBe('')
  })

  it('readOutput marks stderr sections', async () => {
    const { shell } = await setup()
    const proc = shell.start(shell.resolve({ command: 'echo out; echo err >&2' }))
    await proc.done
    expect(lf(proc.readOutput().delta)).toBe('out\n[stderr]\nerr\n')
  })

  it('kill() terminates the process: true once, false after settlement', async () => {
    const { shell } = await setup()
    const proc = shell.start(shell.resolve({ command: 'sleep 60' }))
    expect(proc.kill()).toBe(true)
    await proc.done
    expect(proc.status).toBe('killed')
    expect(proc.kill()).toBe(false)
  })

  it('kill() returns false for a naturally completed process', async () => {
    const { shell } = await setup()
    const proc = shell.start(shell.resolve({ command: 'echo ok' }))
    await proc.done
    expect(proc.status).toBe('completed')
    expect(proc.kill()).toBe(false)
  })

  it('a background spawn failure settles as killed with the error readable on stderr', async () => {
    const { shell } = await setup()
    const proc = shell.start(shell.resolve({ command: 'echo ok', workdir: '/nonexistent-dsh' }))
    await expect(proc.done).resolves.toBeUndefined()
    expect(proc.status).toBe('killed')
    expect(proc.readOutput().delta).toContain('spawn failed:')
  })
})

/** Filesystem path equality across macOS temp symlinks and Windows drive-letter casing. */
function samePath(actual: string, expected: string): boolean {
  const norm = (value: string) => (
    process.platform === 'win32' ? realpathSync.native(value).toLowerCase() : realpathSync.native(value)
  )
  return norm(actual) === norm(expected)
}

/**
 * Poll a handle's consuming readOutput until the ACCUMULATED delta contains
 * `expected`; returns the accumulation (reads never re-deliver, so the caller
 * gets everything produced up to the match).
 */
async function readUntil(proc: ShellProcess, expected: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let all = ''
  while (Date.now() < deadline) {
    all += proc.readOutput().delta
    if (lf(all).includes(expected)) return lf(all)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`process output did not include ${JSON.stringify(expected)}; accumulated ${JSON.stringify(lf(all))}`)
}
