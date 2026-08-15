# @cmx666/dsh-winuxsh-sandbox

English | [中文](README.zh.md)

Sandbox-consuming Winuxsh implementation of the [`ctx.shell` executor seam](../shell/): every command runs as `<winuxsh> -c <command>` **confined through `ctx.sandbox`**, with the selected mode, enforcement, and denial facts stamped on each settled result. The winuxsh twin of [`@deepseek-ai/dsh-pwsh-sandbox`](../pwsh-sandbox/), a call-for-call mirror — the confinement substance is platform-neutral: on Windows the sandbox seam resolves to the ACL restricted-token runner chain ([`@deepseek-ai/dsh-sandbox-windows-acl`](../../sandbox/sandbox-windows-acl/)), on Linux/macOS to bwrap/Landlock/Seatbelt.

The executor inherits [`@deepseek-ai/dsh-winuxsh-local`](../winuxsh-local/)'s process mechanics and consumes its argv-level seam (`argv()` / `runArgv()` / `startArgv()` / `onProcessDone()`) to wrap the exact winuxsh invocation through the provider. The sandbox policy (mode + workspace root) is NOT this package's config: it rides each call from `ctx.sandboxPolicy` (tool calls pass the calling session's resolved policy; direct calls fall back to deployment policy).

## Behavior

- `danger-full-access`: commands run through the local executor unchanged; results carry `sandbox: { mode, denied: false }`.
- Confined modes (`read-only`, `workspace-write`): the winuxsh argv is wrapped by `ctx.sandbox.confine()`; runner-launch refusal fails closed with `SANDBOX_UNAVAILABLE` (foreground throw, background `runnerFailed` fact), and a denied write classifies against the selected backend's `denialSignatures` into `sandbox.denied`.

## Model Experience

### Confinement works, denial surfaces as command failure

#### What the model sees

The confined command's own stderr (e.g. `Access to the path '...' is denied.` under the Windows ACL runner); the tool layer converts classified denials into the standard permission-denied surface exactly as it does for the bash tool.

#### Token effect

No model-visible text beyond the command's stderr and the tool layer's standard denial surface.

#### KV Cache effect

None directly; the denial surface belongs to the tool layer.

## Known Limitations and Deferred Work

- **Reads are unrestricted** on Windows (the ACL runner restricts writes only); the read boundary is documented in `@deepseek-ai/dsh-sandbox-windows-acl`.
- **Windows workspace-write temp authority is private** per live session/workspace pair; agentless calls receive a fresh private directory per invocation. The ambient temp root is never granted, and the runner rewrites TMP/TEMP to the private directory before spawning.
- **Windows read-only grants no explicit writable root but remains partial** because the restricted token must retain Everyone. Objects whose DACL grants Everyone write access — including compatible opens of the NUL device — remain ambient authority; winuxsh's `> /dev/null`-style redirection semantics inherit whatever the backend grants.
- **No real-provider e2e suite yet** — the ACL-runner integration coverage lives in the pwsh twin's `tests/acl.e2e.ts` (the runner is provider-side and shared), so winuxsh exercises the same runner through the shared seam.
