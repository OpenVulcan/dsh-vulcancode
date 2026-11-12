import { SITES, type Credential } from '@openvulcan/openvulcan-account'
import type { VoiceCatalog, VoiceErrorCode, VoiceModel, VoiceSelection } from './contract.js'

// The version-one microphone contract accepts 120 seconds of canonical 16 kHz mono PCM.
// 第一版麦克风协议接受最长 120 秒的标准 16 kHz 单声道 PCM。
export const MAX_SECONDS = 120
// The audio and JSON limits apply before parsing or copying upstream data.
// 在解析或复制上游数据前执行音频和 JSON 体积上限。
export const MAX_AUDIO_BYTES = 44 + MAX_SECONDS * 16_000 * 2
const MAX_JSON_BYTES = 1024 * 1024
// Only these paths under the regional Auth origin serve the free microphone channel.
// 只有各站点 Auth 域名下的这些路径提供免费麦克风通道。
const BASE = '/api/v1/vulcancode/voice-input/'

/**
 * A classified voice failure with an HTTP status and optional upstream wait time.
 * 带 HTTP 状态和可选上游等待时间的语音输入错误。
 */
export class VoiceFailure extends Error {
  constructor(readonly code: VoiceErrorCode, readonly status: number, readonly retryAfter?: number) {
    super(code)
  }
}

/**
 * The validated site catalogue, or null if its microphone channel is disabled.
 * 经校验的站点模型目录。站点麦克风通道停用时为 null。
 */
export type Publication = VoiceCatalog | null

/**
 * Read a body within the supplied byte limit. Oversized streams are cancelled before parsing.
 * 在指定字节限制内读取正文。超限时在解析前取消流。
 */
export async function readBounded(
  message: Request | Response, limit: number, failure: VoiceFailure, signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = message.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    void message.body?.cancel().catch(() => {})
    throw failure
  }
  if (message.body === null) return new Uint8Array(0)
  const reader = message.body.getReader()
  const bytes = new Uint8Array(limit)
  let length = 0
  // Cancel a slow upload when its caller, authorization or deadline ends.
  // 调用方、设备授权或截止时间结束时取消缓慢上传。
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    if (signal?.aborted) cancel()
    for (;;) {
      const chunk = await reader.read()
      signal?.throwIfAborted()
      if (chunk.done) return bytes.subarray(0, length)
      if (length + chunk.value.byteLength > limit) {
        void reader.cancel().catch(() => {})
        throw failure
      }
      bytes.set(chunk.value, length)
      length += chunk.value.byteLength
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/**
 * Validate the precise PCM WAV produced by the browser encoder before sending it upstream.
 * 在转发前校验浏览器编码器生成的精确 PCM WAV 格式。
 */
export function validateWav(bytes: Uint8Array): void {
  if (bytes.length <= 44 || bytes.length > MAX_AUDIO_BYTES || bytes.length % 2 !== 0) {
    throw new VoiceFailure('invalid_audio', 400)
  }
  const wav = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (wav.getUint32(0) !== 0x52494646 || wav.getUint32(4, true) !== bytes.length - 8 ||
      wav.getUint32(8) !== 0x57415645 || wav.getUint32(12) !== 0x666d7420 || wav.getUint32(16, true) !== 16 ||
      wav.getUint16(20, true) !== 1 || wav.getUint16(22, true) !== 1 || wav.getUint32(24, true) !== 16_000 ||
      wav.getUint32(28, true) !== 32_000 || wav.getUint16(32, true) !== 2 || wav.getUint16(34, true) !== 16 ||
      wav.getUint32(36) !== 0x64617461 || wav.getUint32(40, true) !== bytes.length - 44) {
    throw new VoiceFailure('invalid_audio', 400)
  }
}

/**
 * Narrow a JSON object before reading protocol fields.
 * 在读取协议字段前将 JSON 值缩窄为对象。
 */
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the version-one catalogue and the reference to its published default.
 * 校验第一版模型目录及其已发布的默认模型引用。
 */
function parsePublication(value: unknown): Publication {
  if (!object(value) || value.contract_version !== 1 || value.max_duration_seconds !== MAX_SECONDS ||
      typeof value.available !== 'boolean' || typeof value.default_model_id !== 'string' ||
      !Array.isArray(value.models)) throw new VoiceFailure('unavailable', 502)
  if (!value.available && value.default_model_id === '' && value.models.length === 0) return null
  if (!value.available || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value.default_model_id)) {
    throw new VoiceFailure('unavailable', 502)
  }
  // Validate every entry before exposing it as a selectable model or header value.
  // 逐条验证目录，再将条目用于模型选择或请求头。
  const models: VoiceModel[] = []
  const ids = new Set<string>()
  for (const model of value.models) {
    if (!object(model) || typeof model.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(model.id) ||
        ids.has(model.id) || model.category !== 'speech_transcribe' || typeof model.display_name !== 'string' ||
        model.display_name.trim() === '' || !Array.isArray(model.supported_languages) ||
        !model.supported_languages.every((language: unknown): language is string =>
          typeof language === 'string' && /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) ||
        new Set(model.supported_languages).size !== model.supported_languages.length) {
      throw new VoiceFailure('unavailable', 502)
    }
    ids.add(model.id)
    models.push({ id: model.id, label: model.display_name, languages: model.supported_languages })
  }
  if (!ids.has(value.default_model_id)) throw new VoiceFailure('unavailable', 502)
  return { defaultModelId: value.default_model_id, models }
}

/**
 * Send one native request to the account's Auth domain. Redirects would move the credential or audio.
 * 向账号的 Auth 域名发送一次原生请求。重定向会转移凭据或录音，因此禁止重定向。
 */
async function send(
  transport: typeof fetch, credential: Credential, path: 'capabilities' | 'transcriptions',
  signal: AbortSignal, upload?: { readonly selection: VoiceSelection; readonly wav: Uint8Array<ArrayBuffer> },
): Promise<unknown> {
  const origin = SITES[credential.site].auth
  if (credential.auth_origin !== origin) throw new VoiceFailure('signed_out', 401)
  const headers = new Headers({ authorization: `Auth ${credential.access_token}`, accept: 'application/json' })
  if (upload !== undefined) {
    headers.set('content-type', 'audio/wav')
    headers.set('x-vulcan-voice-model', upload.selection.modelId)
    if (upload.selection.language !== undefined) headers.set('x-vulcan-asr-language', upload.selection.language)
  }
  const response = await transport(`${origin}${BASE}${path}`, {
    method: upload === undefined ? 'GET' : 'POST',
    headers,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(upload === undefined ? 5000 : 65000)]),
    ...(upload === undefined ? {} : { body: upload.wav }),
  })
  if (response.status === 401) {
    void response.body?.cancel().catch(() => {})
    throw new VoiceFailure('signed_out', 401)
  }
  const bytes = await readBounded(response, MAX_JSON_BYTES, new VoiceFailure('unavailable', 502))
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (response.status === 200) return value
  const code = object(value) && object(value.error) ? value.error.code : undefined
  if ((response.status === 404 && code === 'voice_model_unavailable') ||
      (response.status === 400 && code === 'unsupported_voice_language')) throw new VoiceFailure('selection_unavailable', 409)
  const wait = Number(response.headers.get('retry-after'))
  const retryAfter = Number.isInteger(wait) && wait >= 1 && wait <= 86_400 ? wait : undefined
  if (response.status === 429 && code === 'voice_rate_limited') throw new VoiceFailure('rate_limited', 429, retryAfter)
  if (response.status === 503 && code === 'voice_busy') throw new VoiceFailure('busy', 503, retryAfter)
  if (code === 'invalid_voice_audio' || code === 'voice_audio_too_large' || code === 'unsupported_voice_audio') {
    throw new VoiceFailure('invalid_audio', 400)
  }
  throw new VoiceFailure('unavailable', 502)
}

/**
 * Get the free channel's current catalogue for one verified regional credential.
 * 根据已校验的区域凭据读取免费通道当前的模型目录。
 */
export async function getPublication(
  transport: typeof fetch, credential: Credential, signal: AbortSignal,
): Promise<Publication> {
  return parsePublication(await send(transport, credential, 'capabilities', signal))
}

/**
 * Send one bounded recording to the selected publication and return its recognized text.
 * 向已选发布模型发送一段有界录音并返回识别文本。
 */
export async function transcribe(
  transport: typeof fetch, credential: Credential, signal: AbortSignal,
  selection: VoiceSelection, wav: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const result = await send(transport, credential, 'transcriptions', signal, { selection, wav })
  if (!object(result) || typeof result.text !== 'string' ||
      typeof result.request_id !== 'string' || result.request_id.length === 0) {
    throw new VoiceFailure('unavailable', 502)
  }
  return result.text
}
