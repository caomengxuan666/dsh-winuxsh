# @cmx666/dsh-winuxsh-bundle

One-command DSH profile bundle for Windows Winuxsh support.

```sh
dsh plugin --profile web add @cmx666/dsh-winuxsh-bundle
```

The bundle installs the Winuxsh providers, enables `winuxsh-sandbox` and `tool-bash`, and disables the PowerShell shell/tool rows. Install Winuxsh separately and ensure `winuxsh.exe` is on `PATH`, then start DSH normally with `dsh web`.
