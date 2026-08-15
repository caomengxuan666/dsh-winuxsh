# @cmx666/dsh-winuxsh-bundle

Windows 上启用 Winuxsh 的一条命令 DSH profile bundle。

```sh
dsh plugin --profile web add @cmx666/dsh-winuxsh-bundle
```

此 bundle 会安装 Winuxsh Provider，启用 `winuxsh-sandbox` 和 `tool-bash`，并禁用 PowerShell shell/tool。请另外安装 Winuxsh，并确保 `winuxsh.exe` 位于 `PATH`，然后正常启动 `dsh web`。
