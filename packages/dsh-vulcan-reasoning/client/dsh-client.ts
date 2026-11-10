import type { ReactNode } from 'react'

import type { ModelIdentity, SettingsOp } from './shared'

// Business results of dsh's generated remote services.
// dsh 生成的远程服务返回的业务结果。
type RemoteResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

// The fields read from a redacted settings namespace returned by describe or mutate.
// 从 describe 或 mutate 返回的脱敏设置命名空间中读取的字段。
export interface NamespaceView {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}

// The existing dsh remote settings and model catalog APIs used by the editor.
// 编辑器使用的 dsh 现有远程设置和模型目录接口。
export interface Remote {
  readonly settings: {
    // Return redacted settings values and provider writability.
    // 返回脱敏设置值及设置提供方的可写状态。
    describe(): Promise<RemoteResult<{ readonly writable: boolean; readonly namespaces: readonly NamespaceView[] }>>
    // Apply the given operations to a namespace at its expected revision and return the committed view.
    // 在预期版本上对命名空间应用操作，并返回提交后的视图。
    mutate(ns: string, ops: readonly SettingsOp[], expectedRevision: number): Promise<RemoteResult<NamespaceView>>
  }
  readonly session: {
    // Return model groups for identifying inherited models by their exact provider and model IDs.
    // 返回模型分组，以按准确的提供商和模型标识识别继承的模型。
    modelCatalog(): Promise<RemoteResult<{
      readonly groups: readonly { readonly id: string; readonly models: readonly ModelIdentity[] }[]
      readonly failures: readonly { readonly id: string; readonly message: string }[]
    }>>
  }
}

// The provider-card owner props and the dsh permission hook used here.
// 此处使用的提供商卡片宿主参数与 dsh 权限 Hook。
export interface ProviderCardProps {
  readonly provider: { readonly provider: string }
  readonly configured: boolean
  readonly t: (key: string) => string
  // Return whether the current client may call the requested remote endpoint.
  // 返回当前客户端是否可调用请求的远程端点。
  useRemoteAccess(action: 'settings/describe' | 'settings/mutate'): boolean
}

// The subset of the dsh client context that loads the contribution.
// 用于加载扩展的 dsh 客户端上下文子集。
export interface ClientContext {
  readonly remote: Remote
  // Install a lifecycle effect and use its return value to dispose the effect.
  // 安装生命周期副作用，并使用其返回的函数清理副作用。
  effect(execute: () => () => void, label?: string): void
  readonly locale: {
    // Register dictionaries for the namespace and return an unregister function.
    // 注册命名空间的文案词典并返回注销函数。
    register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
  }
  readonly slots: {
    // Wait for the provider-card slot and register an effect for its lifetime.
    // 等待提供商卡片插槽，并在其生命周期内注册副作用。
    inject(name: 'settings.models.provider-card', callback: () => () => void): void
    // Register a component for the specified adapter key and return its disposer.
    // 为指定适配器键注册组件并返回注销函数。
    register(
      options: { readonly name: 'settings.models.provider-card'; readonly key: string; readonly locale: string },
      component: (props: ProviderCardProps) => ReactNode,
    ): () => void
  }
}
