import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox'
import { resolveWinuxshPath } from '@cmx666/dsh-winuxsh-local'

class SandboxWinuxshExecutor extends SandboxPwshExecutor {
  static inject = ['subprocess', 'sandbox', 'sandboxPolicy']

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

export { SandboxWinuxshExecutor }
export default SandboxWinuxshExecutor
