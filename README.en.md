<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/openvulcan-logo-dark.svg">
  <img src="docs/assets/openvulcan-logo-light.svg" alt="OpenVulcan" width="360">
</picture>

# dsh-vulcancode

**The VulcanCode experience in DeepSeek Harness (dsh)**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[简体中文](README.md) | **English**

</div>

---

## About

dsh-vulcancode is a set of community plugins for DeepSeek Harness (dsh). One package brings several of
VulcanCode's core features. It supports dsh `0.2.1-rc.2` and later, below `0.3.0`:

```sh
dsh plugin add @openvulcan/dsh-vulcancode
```

This project is not affiliated with DeepSeek; dsh is a DeepSeek product.

| Part | What it does |
| --- | --- |
| OpenVulcan account | Sign in once; every part of the suite uses it. The credential is kept in dsh's credential store. Settings are under Settings › OpenVulcan account |
| Auto approval (Vulcan Decision) | Before every tool call, a dedicated decision model answers allow, review or block; calls not allowed can go to a review LLM, then to you or a denial |
| Interactive answers | The model can answer with VulcanCode's `ui-*` components, rendered in the chat; on by default once enabled, and can be turned off per session |
| LuaSkills | Skills as tools for the AI, with the default skill codekit (code navigation). The runtime (about 190 MB) is installed on demand from Settings › LuaSkills and connects on its own once installed. The LuaSkills page in the sidebar manages installed skills and the LuaSkills Hub |
| Vulcan look | VulcanCode's themes, square corners and colors |

> **Our commitment: the cloud command decision model is free, permanently.** (October 27, 2026)

## Usage

1. Restart dsh after installing, open Settings › OpenVulcan account, and sign in at the Global or China site.
2. Open Settings › Auto approval, then choose "Auto review" in the permission picker or switch the integration
   to "Standalone switch". Without signing in, you can judge with a local model instead.
3. For LuaSkills, open Settings › LuaSkills and install the runtime; progress shows on the page, and the skill tools appear when it finishes.
4. Interactive answers and the look work once installed; adjust them in their own settings.

## Limits of auto approval

- It guards against the AI's **mistakes** when running commands, not against the AI **deliberately getting
  around it** (for example by writing a script and then running it).
- No error is ever treated as allow; unattended sessions never ask you, and a call the review does not allow
  is denied.
- Auto approval lowers the odds of an accident; it does not guarantee that every risk is refused. Keep using a
  sandbox, Git and backups.

## Packages

| Package | Description |
| --- | --- |
| `@openvulcan/dsh-vulcancode` | The suite, the only package dsh installs; all others are bundled inside |
| `@openvulcan/dsh-vulcan-account` | The OpenVulcan account plugin; offers the `openvulcanAccount` service to the others |
| `@openvulcan/dsh-decision-guard` | The auto approval plugin |
| `@openvulcan/dsh-vulcan-answers` | The interactive answers plugin |
| `@openvulcan/dsh-vulcan-luaskills` | The LuaSkills plugin: runtime install, skill tools, VM settings and the Hub |
| `@openvulcan/dsh-vulcan-style` | The look plugin |
| `@openvulcan/vulcan-decision` | The decision engine and the `vulcan-decision` command line |
| `@openvulcan/openvulcan-account` | The OpenVulcan account library: sign-in, refresh and the credential store interface |

## Development

```sh
pnpm install
pnpm run build
pnpm run test
pnpm run pack:dsh   # writes dist/openvulcan-dsh-vulcancode-<version>.tgz
```

Install the packed suite locally with `dsh plugin add ./dist/openvulcan-dsh-vulcancode-<version>.tgz`.

## Thanks

Thanks to the [LINUX DO](https://linux.do/) community for its support and discussions.

## License

[MIT](LICENSE)
