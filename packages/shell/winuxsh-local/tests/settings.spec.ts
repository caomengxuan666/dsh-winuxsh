/** The shared `bash` settings section as the winuxsh executor family resolves it. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SHELL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-shell'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { WinuxshLocalExecutor } from '@deepseek-ai/dsh-winuxsh-local'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(config: ConstructorParameters<typeof WinuxshLocalExecutor>[1] = {}): Promise<{
  ctx: Context
  settingsFiber: Fiber
  executorFiber: Fiber
  winuxsh: WinuxshLocalExecutor
}> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const executorFiber = ctx.plugin(WinuxshLocalExecutor, { timeoutMs: 60_000, ...config })
  await executorFiber.await()
  return { ctx, settingsFiber, executorFiber, winuxsh: ctx.shell as WinuxshLocalExecutor }
}

describe('winuxsh executor over the bash settings section', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.winuxsh.config.timeoutMs).toBe(60_000)

    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 5_000 })

    expect(bench.winuxsh.config.timeoutMs).toBe(5_000)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a stored value the constructor would have rejected', async () => {
    const bench = await boot()

    await expect(bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 0 }))
      .rejects.toThrow(/winuxsh-local: timeoutMs must be a positive finite number/)

    expect(bench.winuxsh.config.timeoutMs).toBe(60_000)
    await bench.ctx.fiber.dispose()
  })

  it('re-resolves the executable when the stored path changes', async () => {
    const bench = await boot({ winuxshPath: '/opt/first/winuxsh' })
    expect(bench.winuxsh.winuxshPath).toBe('/opt/first/winuxsh')

    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { winuxshPath: '/opt/second/winuxsh' })

    expect(bench.winuxsh.winuxshPath).toBe('/opt/second/winuxsh')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the resolved executable when an unrelated field changes', async () => {
    const bench = await boot({ winuxshPath: '/opt/first/winuxsh' })
    const before = bench.winuxsh.winuxshPath

    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 5_000 })

    expect(bench.winuxsh.winuxshPath).toBe(before)
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({ winuxshPath: '/opt/first/winuxsh' })
    await bench.ctx.settings.update(SHELL_SETTINGS_NAMESPACE, { timeoutMs: 5_000, winuxshPath: '/opt/second/winuxsh' })
    expect(bench.winuxsh.config.timeoutMs).toBe(5_000)
    expect(bench.winuxsh.winuxshPath).toBe('/opt/second/winuxsh')

    await bench.settingsFiber.dispose()

    expect(bench.winuxsh.config.timeoutMs).toBe(60_000)
    expect(bench.winuxsh.winuxshPath).toBe('/opt/first/winuxsh')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the executor unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('shell')

    await bench.executorFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('shell')
    await bench.ctx.fiber.dispose()
  })
})
