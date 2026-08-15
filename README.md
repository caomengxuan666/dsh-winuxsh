# DSH Winuxsh Plugins

Winuxsh support for [DeepSeek Harness](https://github.com/caomengxuan666/deepseek-harness-desktop): runtime providers, a one-command profile bundle, and the Web Settings card.

## Install For Official DSH

Install Winuxsh first and make `winuxsh.exe` available on `PATH`. Then run one command:

```sh
dsh plugin --profile web add @cmx666/dsh-winuxsh-bundle@0.1.0-rc.8
```

Start DSH normally:

```sh
dsh web
```

The bundle enables `winuxsh-sandbox` and `tool-bash`, disables the PowerShell shell/tool rows, adds the Winuxsh card under Settings > Plugins, and moves Session export into the session action group.

## Packages

- `@cmx666/dsh-winuxsh-local`: local Winuxsh executor.
- `@cmx666/dsh-winuxsh-sandbox`: sandboxed Winuxsh executor.
- `@cmx666/dsh-winuxsh-bundle`: one-command DSH profile bundle.
- `@cmx666/dsh-client-ui-winuxsh`: Web Settings card and client session action placement.

## Desktop

The Frameless Desktop integration lives in the main repository and installs the bundle automatically:

<https://github.com/caomengxuan666/deepseek-harness-desktop>

## Source And Releases

- Source: <https://github.com/caomengxuan666/dsh-winuxsh>
- Desktop releases: <https://github.com/caomengxuan666/deepseek-harness-desktop/releases>
- npm scope: <https://www.npmjs.com/org/cmx666>

## Development

Each package is independently publishable from its package directory. The source mirrors the package contents published to npm; Desktop integration remains in the Desktop repository.

## License

See the individual package metadata and upstream DSH license terms.
