<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/openvulcan-logo-dark.svg">
  <img src="docs/assets/openvulcan-logo-light.svg" alt="OpenVulcan" width="360">
</picture>

# dsh-vulcancode

**把 VulcanCode 的体验带进 DeepSeek Harness（dsh）**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**简体中文** | [English](README.en.md)

</div>

---

## 关于项目

dsh-vulcancode 是 DeepSeek Harness（dsh）的一组社区插件，安装一个包即可得到 VulcanCode 的几项核心能力。
适配 dsh `0.2.1-rc.2` 及以上、`0.3.0` 以下：

```sh
dsh plugin add @openvulcan/dsh-vulcancode
```

本项目与 DeepSeek 无关联，dsh 是 DeepSeek 的产品。

| 组成 | 作用 |
| --- | --- |
| OpenVulcan 账号 | 登录一次，套件内各插件共用；凭据保存在 dsh 的凭据存储中。设置位于「设置 › OpenVulcan 账号」 |
| 自动审批（Vulcan Decision） | 每次工具调用前由专用判定模型判断放行、需确认或拦下；未放行的可交复核 LLM，再询问你或拒绝 |
| 交互式回答 | 模型可以用 VulcanCode 的 `ui-*` 组件作答，在对话中渲染；启用后默认开启，可按会话关闭 |
| Vulcan 界面风格 | VulcanCode 的主题、直角与配色 |

> **我们承诺：云端命令判定模型永久免费提供。**（2026 年 10 月 27 日）

## 使用

1. 安装后重启 dsh，打开「设置 › OpenVulcan 账号」，选择国际站或中国站登录。
2. 打开「设置 › 自动审批」，在权限选择器中选择“自动审查”，或把接入方式改为“独立开关”。不登录也可以改用本机
   模型判定。
3. 交互式回答和界面风格安装即生效，可在各自的设置中调整。

## 自动审批的边界

- 它防的是 AI 执行命令时的**失误**，不防 AI **刻意绕过**（例如先写一个脚本再运行它）。
- 任何错误都不会被当作放行；无人值守的会话从不询问你，复核未放行即拒绝。
- 自动审批只降低事故概率，不保证拒绝一切风险；请同时使用沙箱、Git 与备份。

## 包结构

| 包 | 说明 |
| --- | --- |
| `@openvulcan/dsh-vulcancode` | 套件本体，dsh 安装的唯一入口，其余包都打包在内 |
| `@openvulcan/dsh-vulcan-account` | OpenVulcan 账号插件，向其他插件提供 `openvulcanAccount` 服务 |
| `@openvulcan/dsh-decision-guard` | 自动审批插件 |
| `@openvulcan/dsh-vulcan-answers` | 交互式回答插件 |
| `@openvulcan/dsh-vulcan-style` | 界面风格插件 |
| `@openvulcan/vulcan-decision` | 判定引擎与命令行 `vulcan-decision` |
| `@openvulcan/openvulcan-account` | OpenVulcan 账号库：登录、刷新与凭据存储接口 |

## 开发

```sh
pnpm install
pnpm run build
pnpm run test
pnpm run pack:dsh   # 生成 dist/openvulcan-dsh-vulcancode-<版本>.tgz
```

本地安装打包结果：`dsh plugin add ./dist/openvulcan-dsh-vulcancode-<版本>.tgz`。

## 致谢

感谢 [LINUX DO](https://linux.do/) 社区的支持与交流。

## 许可

[MIT](LICENSE)
