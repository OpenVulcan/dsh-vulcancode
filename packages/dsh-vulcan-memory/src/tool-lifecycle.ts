import { unwatchFile, watchFile } from 'node:fs'
import path from 'node:path'
import { loadSettings, SETTINGS_FILE, type MemoryMode, type SavedMemorySettings } from './settings.js'

// Synchronize tool availability after saves and stop observing when the plugin unloads.
// 保存设置后同步工具可见性，在插件卸载时停止监听。
interface ToolLifecycle {
  refresh(): void
  dispose(): void
}

/** Expose only the tools for the saved mode and observe changes made by other DSH processes.
 *  仅暴露已保存模式对应的工具，并监听其他 DSH 进程保存的更改。 */
export function watchMemoryTools(root: string, register: (mode: Exclude<MemoryMode, 'off'>) => () => void,
  warn: (error: unknown) => void, onActivation?: (settings: SavedMemorySettings | undefined) => void): ToolLifecycle {
  const file = path.join(root, SETTINGS_FILE)
  // Track the installed catalog independently of settings reads that can fail.
  // 单独跟踪当前注册的工具目录，设置读取可能失败。
  let activeMode: Exclude<MemoryMode, 'off'> | undefined
  let unregister: (() => void) | undefined
  // Publish activation changes even when the final mode matches the current catalog.
  // 最终模式与当前目录相同时，也通知激活周期的变化。
  let activation: string | undefined
  /** Withdraw the current catalog before publishing another mode.
   *  发布其他模式的工具之前撤销当前目录。 */
  const clear = (): void => {
    unregister?.()
    unregister = undefined
    activeMode = undefined
  }
  /** Apply current settings and report errors outside the request preparation path.
   *  应用当前设置，在请求准备路径之外报告错误。 */
  const refresh = (): void => {
    try {
      const settings = loadSettings(root)
      const { mode } = settings
      if (settings.activation !== activation) {
        activation = settings.activation
        onActivation?.(settings)
      }
      if (mode === activeMode) return
      clear()
      if (mode !== 'off') {
        unregister = register(mode)
        activeMode = mode
      }
    } catch (error) {
      clear()
      if (activation !== undefined) {
        activation = undefined
        onActivation?.(undefined)
      }
      warn(error)
    }
  }
  refresh()
  watchFile(file, { persistent: false, interval: 750 }, refresh)
  return {
    refresh,
    /** Stop observing the settings file and remove any active tools.
     *  停止监听设置文件并撤销已注册的工具。 */
    dispose() {
      unwatchFile(file, refresh)
      clear()
    },
  }
}
