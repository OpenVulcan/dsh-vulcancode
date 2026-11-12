<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/openvulcan-logo-dark.svg">
  <img src="docs/assets/openvulcan-logo-light.svg" alt="OpenVulcan" width="360">
</picture>

# dsh-vulcancode

**The VulcanCode experience in DeepSeek Harness (dsh)**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@openvulcan/dsh-vulcancode)](https://www.npmjs.com/package/@openvulcan/dsh-vulcancode)

[简体中文](README.md) | **English**

[Features](#features) · [Screenshots](#screenshots) · [Architecture and packages](#architecture-and-packages) · [Quick start](#quick-start) · [Development](#development)

</div>

---

## About

dsh-vulcancode is a community plugin suite for DeepSeek Harness (dsh). Install one package to add VulcanCode styling, interactive answers, auto approval, LuaSkills, long-term memory, and per-model thinking settings for pi-ai.

DeepSeek develops dsh independently of this community project.

## Features

- **Desktop workspace** with VulcanCode colors, an independent square-corner toggle, and settings pages that use the wider content area.
- **Interactive results** with charts, diagrams, and decision cards rendered in the conversation. Selections from decision cards can go back into the composer.
- **Tool-call review** with a cloud or local Vulcan Decision model, optional LLM review, and user confirmation before execution.
- **Reusable skills and memory** through LuaSkills tools and persistent Markdown memory for the user, space, and project.
- **Per-model thinking settings** for the levels shown in the pi-ai model picker and the values sent to each model endpoint.
- **Voice input** uses the free transcription service on your OpenVulcan account's site and inserts the result into the conversation draft.

## Screenshots

### Dark theme · Tool categories

![An interactive answer presents tool categories as cards in the Vulcan Dark theme](docs/assets/dsh-vulcan-dark.png)

### Command theme · Memory tool verification

![An interactive answer presents memory tool verification as metric cards, a checklist, and a table in the Vulcan Command theme](docs/assets/dsh-vulcan-command.png)

## Architecture and packages

dsh loads eight plugins through the suite's `cordis.patch.yml`. Auto approval and voice input get their cloud credentials from `openvulcanAccount`. The account plugin and the decision engine share the account library. The suite's tarball bundles its workspace dependencies.

### Suite entry point

#### `@openvulcan/dsh-vulcancode`

The suite declares its plugin group through `dsh.bundle.patch`. dsh loads the components through their `apply(ctx)` entry points or, for the account plugin, through its Cordis service class. After installation, the Plugins page lists the suite and its components. See [packages/dsh-vulcancode](packages/dsh-vulcancode).

### dsh plugins

#### `@openvulcan/dsh-vulcan-account`

Open Settings › OpenVulcan account, choose Global or China, and approve the device in your browser. The same page shows account status and lets you sign out. The plugin keeps credentials in the dsh credential store and exposes the `openvulcanAccount` service for integrations such as cloud judgment. See [packages/dsh-vulcan-account](packages/dsh-vulcan-account).

#### `@openvulcan/dsh-decision-guard`

Open Settings › Auto approval to choose how auto approval integrates with permission presets, configure cloud or local judgment, set LLM review and confirmation rules, and inspect approval records. The decision model classifies tool calls as allow, review, or block. Calls without an allow verdict proceed to review, a user prompt, or denial according to the configuration. See [limits of auto approval](#limits-of-auto-approval) and the [plugin README](packages/dsh-decision-guard/README.md).

#### `@openvulcan/dsh-vulcan-answers`

Renders the model's `ui-*` code fences in chat as comparisons, charts, flowcharts, sequence diagrams, and decision cards. A decision can be inserted into the composer or sent. Interactive mode is enabled by default. The Answers control in the composer switches the current conversation to standard Markdown starting with the next request. See [packages/dsh-vulcan-answers](packages/dsh-vulcan-answers).

#### `@openvulcan/dsh-vulcan-luaskills`

Install the roughly 190 MB runtime on demand in Settings › LuaSkills. Installation adds CodeKit for code navigation and makes the skill tools available automatically. Settings cover VM pools, the tool cache, managed Python and Node runtimes, and network access. Use the LuaSkills sidebar page to enable, disable, update, or remove skills, or search for and install new ones from the Hub. See [packages/dsh-vulcan-luaskills](packages/dsh-vulcan-luaskills).

#### `@openvulcan/dsh-vulcan-memory`

Stores the user profile, space memory, and project memory in Markdown. It provides `memory_outline`, `memory_search`, `memory_write`, and the `memory-curator` skill. Each conversation starts with a snapshot within the configured budget. Use the Long-term memory sidebar page to edit memory, adjust the budget, or import and export it. Markdown is the available memory mode. See [packages/dsh-vulcan-memory](packages/dsh-vulcan-memory).

#### `@openvulcan/dsh-vulcan-reasoning`

In Settings › Models, open Custom thinking levels on a configured pi-ai provider card. For each model, follow the catalog, disable thinking, or choose the levels offered in chat and their wire values. After saving, select a level in the conversation's model picker. Use values supported by that model's endpoint. See [packages/dsh-vulcan-reasoning](packages/dsh-vulcan-reasoning).

#### `@openvulcan/dsh-vulcan-style`

Use Vulcan style under Settings › General to follow the system or choose Light, Dark, Command, or the built-in dsh theme. Square corners work with any theme and apply to surfaces such as the Windows desktop content frame. The wider settings layout gives the model catalog, built-in plugins, and LuaSkills more room. See [packages/dsh-vulcan-style](packages/dsh-vulcan-style).

#### `@openvulcan/dsh-vulcan-voice-input`

Sign in to OpenVulcan, then hover over the composer microphone to choose a free transcription model from your account's site, a preferred language, a microphone, and a recording shortcut. Open Settings › OpenVulcan voice input to test your microphone or check service status. You can bind a single left or right modifier, such as Right Ctrl. Hold the microphone button or your shortcut in the composer to record. Release it to insert the transcript into the current draft. After 120 seconds, recording stops and transcription starts automatically. See [packages/dsh-vulcan-voice-input](packages/dsh-vulcan-voice-input).

### Shared libraries and CLI

#### `@openvulcan/vulcan-decision`

Provides `allow`, `review`, and `block` verdicts through OpenVulcan cloud endpoints or an optional local runtime. The included `vulcan-decision` CLI can probe the cloud, inspect hardware, manage local runtime packs and models, and judge a single tool call. See the [decision engine and CLI README](packages/vulcan-decision/README.md).

#### `@openvulcan/openvulcan-account`

Handles device authorization, credential refresh, account profiles, and device sign-out through the `CredentialStore` interface. The dsh plugin uses the host credential store, and the standalone CLI uses the library's file-backed store. See [packages/openvulcan-account](packages/openvulcan-account).

## Quick start

The suite declares support for dsh `>=0.2.1-rc.2 <0.3.0`.

### Desktop

Open **Plugins** from the dsh sidebar, click **Add plugin**, and paste the following npm package name into the installation dialog.

```text
@openvulcan/dsh-vulcancode
```

### Web

```sh
dsh plugin --profile web add @openvulcan/dsh-vulcancode
```

### Usage

1. Restart dsh after installing. For cloud judgment, complete browser authorization in Settings › OpenVulcan account. Local judgment works without signing in.
2. Configure judgment in Settings › Auto approval. Select Auto in the permission picker to use judgment with full permissions in the current conversation. Standalone switch applies judgment to all conversations and keeps their existing file sandboxes.
3. To use skill tools, install the runtime in Settings › LuaSkills. The page shows progress and the tools appear automatically when installation finishes.
4. Styling, interactive answers, and Markdown memory are enabled by default. Configure a pi-ai provider before editing a model's thinking levels.

> **We commit to keeping the cloud command judgment model free forever.** (October 27, 2026)

## Limits of auto approval

- It reduces accidental command execution risks. An agent deliberately bypassing the check can still write a script and run it.
- Errors never grant approval. In unattended sessions, a call that requires review runs only if the reviewer explicitly allows it.
- Use auto approval alongside the sandbox, Git, and backups.

## Development

```sh
pnpm install
pnpm run build
pnpm run test
pnpm run pack:dsh   # writes dist/openvulcan-dsh-vulcancode-<version>.tgz
```

Install a local tarball in the Web profile with `dsh plugin --profile web add ./dist/openvulcan-dsh-vulcancode-<version>.tgz`.

## Thanks

Thanks to the [LINUX DO](https://linux.do/) community for its support and discussions.

## License

[MIT](LICENSE)
