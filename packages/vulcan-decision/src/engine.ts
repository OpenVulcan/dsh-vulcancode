/**
 * One entry point for hosts: judge a call with the cloud or the local backend, as selected.
 */

import type { AccountSource } from '@openvulcan/openvulcan-account'
import { EdgeClient } from './cloud/edge.js'
import type { DecisionHome } from './home.js'
import { LocalEngine, type LocalSelection } from './local/engine.js'
import { DecisionError, type BackendKind, type DecisionOptions, type JudgeCall, type Verdict } from './protocol.js'
import { renderCall } from './render.js'

/** How the host wants calls judged. */
export interface EngineSettings {
  readonly backend: BackendKind
  /** Cloud model id; empty uses the first model OpenVulcan lists for the account. */
  readonly cloudModel: string
  /** Endpoint id the user locked; absent means the measured best. */
  readonly cloudEndpoint?: string
  /** Installed pack and model for the local backend. */
  readonly local?: LocalSelection
  readonly options: DecisionOptions
}

export interface EngineOptions {
  readonly home: DecisionHome
  /** The OpenVulcan account the cloud backend signs its requests with; the host owns signing in. */
  readonly account: AccountSource
}

export class DecisionEngine {
  readonly home: DecisionHome
  readonly account: AccountSource
  readonly cloud: EdgeClient
  readonly local: LocalEngine

  constructor(options: EngineOptions) {
    this.home = options.home
    this.account = options.account
    this.cloud = new EdgeClient(this.account)
    this.local = new LocalEngine(options.home)
  }

  /**
   * Judge one call.
   * @throws DecisionError for every failure; hosts must treat it as "not allowed".
   */
  async judge(call: JudgeCall, settings: EngineSettings): Promise<Verdict> {
    const input = { settings: settings.options, rendered: renderCall(call) }
    const started = performance.now()
    if (settings.backend === 'cloud') {
      const model = await this.cloud.resolveModel(settings.cloudModel)
      const { results, endpoint } = await this.cloud.judge(model, [input], settings.cloudEndpoint)
      return { ...results[0]!, backend: 'cloud', model, via: endpoint, elapsed_ms: Math.round(performance.now() - started) }
    }
    if (settings.local === undefined) throw new DecisionError('not_installed', 'no local runtime pack and model are selected')
    const [result] = await this.local.judge(settings.local, [input])
    return { ...result!, backend: 'local', model: settings.local.model, via: settings.local.pack, elapsed_ms: Math.round(performance.now() - started) }
  }

  stop(): void {
    this.local.stop()
  }
}
