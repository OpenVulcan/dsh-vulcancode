import { unwatchFile, watchFile } from 'node:fs'
import path from 'node:path'
import { loadSettings, SETTINGS_FILE } from '../settings.js'

// Synchronize tool availability after saves and stop observing when the plugin unloads.
// 保存设置后同步工具可见性，在插件卸载时停止监听。
interface ToolLifecycle {
  refresh(): void
  dispose(): void
}

/** Register tools only while SQLite is selected. The file watch also observes atomic
 *  saves by another DSH process. Invalid settings disable only the SQLite tools.
 *  仅在选择 SQLite 时注册工具。文件监听也能检测其他 DSH 进程的原子保存，
 *  无效设置只会停用 SQLite 工具。 */
export function watchSqliteTools(root: string, register: () => () => void, warn: (error: unknown) => void): ToolLifecycle {
  const file = path.join(root, SETTINGS_FILE)
  let unregister: (() => void) | undefined
  /** Apply current settings and report errors outside the request preparation path.
   *  应用当前设置，在请求准备路径之外报告错误。 */
  const refresh = (): void => {
    try {
      if (loadSettings(root).mode === 'sqlite') {
        unregister ??= register()
        return
      }
    } catch (error) { warn(error) }
    unregister?.()
    unregister = undefined
  }
  refresh()
  watchFile(file, { persistent: false, interval: 750 }, refresh)
  return {
    refresh,
    /** Stop observing the settings file and remove any active tools.
     *  停止监听设置文件并撤销已注册的工具。 */
    dispose() {
      unwatchFile(file, refresh)
      unregister?.()
      unregister = undefined
    },
  }
}
