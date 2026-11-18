import {
  Capacitor,
  registerPlugin,
  type Plugin,
  type PluginListenerHandle,
} from '@capacitor/core'

/** 原生下载进度：totalBytes 为 -1 表示服务端未提供总大小。 */
export type ApkDownloadProgress = { downloadedBytes: number; totalBytes: number }

export type ApkDownloadResult = { path: string; bytes: number; sha256: string }

/**
 * 应用内 APK 下载 / 安装插件（Java 实现，见 android/app/src/main/java/.../ApkInstallerPlugin.java，
 * MainActivity 里手动注册）。Web / PWA 上不存在，调用方必须先用 isApkInstallerAvailable 探测，
 * 不可用时走浏览器兜底（打开 Release 页面）。
 */
export interface ApkInstallerPlugin extends Plugin {
  downloadApk(options: { url: string; expectedSha256?: string }): Promise<ApkDownloadResult>
  installApk(options: { path: string }): Promise<void>
  canInstall(): Promise<{ canInstall: boolean }>
  openUnknownSourcesSettings(): Promise<void>
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: ApkDownloadProgress) => void
  ): Promise<PluginListenerHandle>
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller')

export const isNativeApp = (): boolean => Capacitor.isNativePlatform()

let availability: Promise<boolean> | null = null

/** 原生插件是否可用：非原生平台直接为 false；原生平台上用一次 canInstall 探测并缓存结果。 */
export const isApkInstallerAvailable = (): Promise<boolean> => {
  if (!availability) {
    availability = (async () => {
      if (!Capacitor.isNativePlatform()) {
        return false
      }
      try {
        await ApkInstaller.canInstall()
        return true
      } catch {
        return false
      }
    })()
  }
  return availability
}

/** 插件在 SHA256 校验失败时以 SHA256_MISMATCH 拒绝（文件已删除，绝不安装）。 */
export const isShaMismatchError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('SHA256_MISMATCH')
