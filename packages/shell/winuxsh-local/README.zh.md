# @cmx666/dsh-winuxsh-local

[English](README.md) | 中文

`@deepseek-ai/dsh-shell` 执行器 seam 的本地 Winuxsh Service Provider，基于 [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) 服务：`WinuxshLocalExecutor` 每次调用以受管进程的方式通过 `ctx.subprocess` spawn `<winuxsh> -c <command>`。它从 [`@deepseek-ai/dsh-pwsh-local`](../pwsh-local/) 继承 PowerShell 执行器家族的整套进程机制——可执行文件解析、命令默认化与上限、超时/取消分类、面向模型的终端环境，以及后台读取的 stdout/stderr 合并。进程组机制（有界 spill 输出、凭据清理、终止升级、dispose（资源释放））属于 subprocess 服务。

Winuxsh 是带 bash 兼容 `-c` 命令域的 Windows 原生 shell：命令字符串作为单个 argv 元素传递，由 winuxsh 自己解析文本，不存在中间 shell，因此没有需要转义的 shell 引号层。原生 Win32 路径（`C:\...`）原样通过。

包根导出默认与具名 `WinuxshLocalExecutor` 插件、其 `Config`，以及纯函数 `resolveWinuxshPath`/`candidateWinuxshPaths` 辅助函数。

## 配置

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

## 行为

这是 `dsh-pwsh-local` 的 winuxsh 对应实现，有意逐次调用保持语义一致：

- **每次调用新建进程，无 shell 状态**——每次调用都是全新的非交互 `winuxsh -c`（确定性；不加载 profile 文件）。`-c` 参数让命令字符串成为 shell 的全部输入，因此启动横幅、profile 或提示符都不会干扰工具输出。
- **组装条目是一层，而不是最终值**——当组装中存在 settings 提供方时，本执行器以上面的条目为 base 注册该能力的 [`bash` 命名空间](../shell/README.md)，因此 `settings.yaml` 中的用户段会叠加其上，下一条命令即按新预算运行。该命名空间与 PowerShell 家族共用，因为一个宿主只组装一个 `ctx.shell` 提供方；在任一平台写下的文档在另一平台仍能解析。schema 无法判定的值（正有限、`graceMs` 的定时器上界）会在写入时被拒绝，运行中的执行器保持它最后一份可用的段。
- **可执行文件解析**——`resolveWinuxshPath` 优先显式 `winuxshPath`，然后逐一探测每个 PATH 条目中的 `winuxsh[.exe]`（剥离两端引号），用 lstat 探测检查（接受真实文件或链接形态的重解析点：Windows 的 app execution alias 对其目标 stat 会因 ACL 失败，但 lstat 能看到别名本身）；否则回退为通过 PATH 解析的裸 `winuxsh`（CreateProcess 会应用 PATHEXT，因此 PATH 上的 `.cmd`/`.bat` 垫片仍然可用）。解析是 `(configured, env, platform)` 的纯函数；它在构造时执行，此后仅当存储的 `winuxshPath` 与当前可执行文件所依据的值不同才再次执行，因此无关的设置变更绝不会重新探测文件系统。
- **受管进程组之上的配置预算**——`resolve()` 从配置填充 `workdir`/`timeoutMs`/`stdoutMaxBytes`，每次 spawn 都向服务提供显式字节上限、spill 上限与 `graceMs`。该宽限期须为正有限值，且不得大于 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)，这样 Node 就能用一个定时器表示它。进程树终止、退出后管道排空宽限、保尾截断与有界 spill 文件是 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) 的机制。前台 `ShellExecRequest.stdoutMaxBytes` 可为单个受信调用方提高 stdout 捕获预算；stderr 与后台运行仍使用 `maxOutputBytes`。
- **超时与取消分类**——`run()` 通过一个 deadline 融合按配置上限截取的超时与调用方信号；只有执行器自身超时报告 `timedOut`，上游取消报告 `aborted`，自我终止的命令两者都不报告（见 [timeout 库 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)）。Windows 将强制终止报告为退出码 1 且无信号，因此带信号标记的事实（`signal`、`killed` 状态）在那里仅限 POSIX；超时/取消分类与平台无关。
- **面向模型的终端环境**——pwsh 孪生的 `NO_COLOR=1 PAGER=cat GIT_PAGER=cat` 再加 `TERM=dumb`（winuxsh 是 bash 兼容方言，因此与 pwsh 不同，POSIX 终端标记适用），作为普通 env 在服务的凭据清理与 `DSH_*` 通道规则之下合并；显式调用方条目仍然优先。
- **后台进程**——`start()` 立即返回存活的 `ShellProcess` 句柄，不设超时；句柄的 `readOutput()` 把服务基于偏移的 stdout/stderr 读取合并为一条按分段标记、通过消费游标推进的增量。仍在运行的进程属于 subprocess 服务，因此它跨执行器重载存活，并随服务 dispose（被终止并 join）。一切任务相关职责（job id、所有权、轮询、通知）都在通用 [`ctx.jobs` 运行时](../../jobs/jobs/README.md) 中，由工具层把句柄注册进去——本执行器从不接触会话或注册表。

## 模型体验

间接地，经由 `dsh-tool-bash` 呈现本执行器的有界 stdout/stderr 尾部、后台进程增量（经通用任务运行时）、spill 文件路径与基础设施失败。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀的任何变更由具名消费方负责。

## 已知限制与暂缓事项

- **自身不设沙箱**——本执行器始终以 harness 进程的权限运行命令；需要隔离的部署应组合启用沙箱的执行器或策略。
- **无持久 shell 或 PTY**——每次调用都是全新的 `winuxsh -c`。
- **命令字符串是 winuxsh 文本**——`-c` 域没有 shell 引号层，但面向模型的命令由 winuxsh 自己解析，因此 winuxsh 语法错误是命令失败，而非启动失败。
- **后台 spawn 失败提示只投递一次**——subprocess 服务不会为从未运行的进程缓冲输出，因此执行器只把 `spawn failed: …` 注入一次 `readOutput()` 增量；丢弃该增量的读取方无法恢复它。
- **Windows 终止不报告信号**——被强制终止的进程以退出码 1、`signal: null` 结束，因此基于信号的状态分类（POSIX `killed`）在 Windows 上不适用；`kill()` 发起的停止仍会直接标记为 `killed`。
- **输出行尾随宿主平台**——winuxsh 在 Windows 上写 CRLF、在 POSIX 上写 LF，因此比较精确输出文本的调用方必须规范化行尾（测试套件即如此）。

清理启发式与 spill 保留的注意事项见 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md)，相关机制由其负责。
