import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'

function resolveWinuxshPath(configured) {
  if (typeof configured === 'string' && configured.length > 0) return configured
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const executable = process.platform === 'win32' ? 'winuxsh.exe' : 'winuxsh'
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    const candidate = join(trimmed, executable)
    try {
      const stat = lstatSync(candidate)
      if (stat.isFile() || stat.isSymbolicLink()) return candidate
    } catch {}
  }
  return 'winuxsh'
}

class WinuxshLocalExecutor extends PwshLocalExecutor {
  static inject = ['subprocess']

  constructor(ctx, config = {}) {
    const configured = config.winuxshPath ?? config.pwshPath
    super(ctx, { ...config, pwshPath: resolveWinuxshPath(configured) })
  }

  get winuxshPath() {
    return this.pwshPath
  }

  argv(spec) {
    return [this.winuxshPath, '-c', spec.command]
  }
}

export { WinuxshLocalExecutor, resolveWinuxshPath }
export default WinuxshLocalExecutor
