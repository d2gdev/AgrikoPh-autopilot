---
name: playwright-mcp-windows-chrome
description: Connect Playwright MCP running in WSL to Sean's existing Windows Chrome through the installed Playwright MCP Bridge extension.
triggers:
  - "Playwright MCP"
  - "Chrome extension"
  - "browser capture"
  - "Windows Chrome"
edges:
  - target: context/setup.md
    condition: when the local Codex or MCP environment must be rebuilt
last_updated: 2026-07-15
---

# Playwright MCP with Windows Chrome

## Context

Codex and `playwright-mcp` run in WSL, while the operator's logged-in Chrome and Playwright MCP Bridge extension run in Windows. The bridge extension ID is `mmlmfjhmonkocbjadbfplnigmagldckm` and is installed in the Windows Chrome `Default` profile.

## Steps

1. Confirm the extension exists at `/mnt/c/Users/Sean/AppData/Local/Google/Chrome/User Data/Default/Extensions/mmlmfjhmonkocbjadbfplnigmagldckm`.
2. Keep the bridge token in the MCP server environment as `PLAYWRIGHT_MCP_EXTENSION_TOKEN`; never put it in project files or command output.
3. Set `PWTEST_EXTENSION_USER_DATA_DIR` to `/mnt/c/Users/Sean/AppData/Local/Google/Chrome/User Data`. The current Playwright MCP implementation uses this variable for extension discovery in cross-platform setups.
4. Launch the server with `playwright-mcp --extension --executable-path "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"`.
5. Use a separate browser tab for automation so existing Merchant Center or operator tabs remain untouched.
6. For brand-SERP evidence, save screenshots and normalized result JSON under `docs/seo/browser/` and record whether signed-out state, location, language, device, and personalization settings were independently confirmed.

## Gotchas

- Public `--user-data-dir` configures a persistent Playwright profile; it does not override extension discovery in extension mode.
- Without `PWTEST_EXTENSION_USER_DATA_DIR`, a WSL process checks `/root/.config/google-chrome` and incorrectly reports that the extension is missing.
- Finding the extension is not enough. The server must launch the Windows Chrome executable so the bridge connection URL opens in the browser that owns the extension.
- `pws=0` disables personalized search, but it does not prove the browser is signed out. Do not count such a capture as a signed-out observation unless account state is independently confirmed.
- Never print or persist the bridge connection URL because it contains the extension token.

## Verify

- [ ] `codex mcp get playwright` shows the server enabled with `--extension` and the Windows Chrome executable.
- [ ] The server environment contains both required variables, with the token masked in all output.
- [ ] `browser_tabs` returns the Playwright Bridge welcome tab instead of a Linux-profile extension error.
- [ ] A separate test tab can navigate and return an accessibility snapshot or evaluated result.

## Debug

- If the error names `/root/.config/google-chrome`, check the `PWTEST_EXTENSION_USER_DATA_DIR` handoff first.
- If extension discovery succeeds but no connection opens, confirm `/mnt/c/Windows/System32/cmd.exe` runs from WSL and the Windows Chrome executable exists.
- If Google returns a challenge page, preserve that evidence and retry through the connected operator browser rather than silently substituting Serper results.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` if browser-capture capability changes.
- [ ] Update this pattern if a Playwright MCP upgrade changes extension discovery or token handling.
