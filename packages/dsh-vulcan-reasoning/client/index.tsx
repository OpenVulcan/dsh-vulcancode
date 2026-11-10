import type { ClientContext } from './dsh-client'
import { en, NAMESPACE, zh, type Translate } from './i18n'
import { ProviderReasoning } from './page'
import { PI_AI_NAMESPACE } from './shared'
import { installStyle } from './style'

// Services supplied by dsh before this browser contribution runs.
// 此浏览器扩展运行前由 dsh 提供的服务。
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.session']

/**
 * Register the localized editor in the existing pi-ai provider-card slot.
 * 在现有 pi-ai 提供商卡片插槽注册本地化编辑器。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyle(), 'vulcan-reasoning: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'vulcan-reasoning: dictionaries')
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: PI_AI_NAMESPACE,
    locale: NAMESPACE,
  }, props => <ProviderReasoning {...props} remote={ctx.remote} t={props.t as Translate} />))
}
