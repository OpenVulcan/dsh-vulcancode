/**
 * Public microphone state returned by the dsh Host. Ready state binds a recording to one authorization.
 * dsh 宿主返回的麦克风公开状态。就绪状态将录音绑定至一次设备授权。
 */
export type VoiceState =
  | { readonly status: 'signed_out' | 'unavailable' }
  | { readonly status: 'disabled'; readonly site: 'cn' | 'global' }
  | {
    readonly status: 'ready'
    readonly site: 'cn' | 'global'
    readonly authorizationId: string
    readonly catalog: VoiceCatalog
    readonly maxSeconds: number
  }

/**
 * Localized failure keys shared by the Host response and composer.
 * 宿主响应与输入框共用的本地化错误键。
 */
export type VoiceErrorCode = 'signed_out' | 'unavailable' | 'selection_unavailable' | 'invalid_audio' | 'rate_limited' | 'busy'

/**
 * The Host returns only text or a stable failure key and optional server wait time.
 * 宿主仅返回转写文本，或稳定的错误键和可选的服务端等待时间。
 */
export type VoiceReply =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: VoiceErrorCode; readonly retryAfter?: number }
/**
 * One published transcription model and its supported language hints.
 * 一个已发布的转写模型及它支持的优先语言。
 */
export interface VoiceModel {
  readonly id: string
  readonly label: string
  readonly languages: readonly string[]
}

/**
 * The regional model catalog used by both voice controls.
 * 两处语音控件共用的站点模型目录。
 */
export interface VoiceCatalog {
  readonly defaultModelId: string
  readonly models: readonly VoiceModel[]
}

/**
 * The exact model and optional language captured when recording begins.
 * 开始录音时捕获的模型及可选优先语言。
 */
export interface VoiceSelection {
  readonly modelId: string
  readonly language?: string
}
