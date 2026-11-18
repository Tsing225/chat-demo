import { create } from 'zustand'
import { APP_VERSION, RELEASES_LATEST_URL, isNewerVersion } from '../version.js'

export type AvailableRelease = {
  tag: string
  htmlUrl: string
  apkUrl: string
  apkName: string
  /** Release 正文里解析出的 APK SHA256；解析不到为 null（仍可下载，靠安装时签名校验兜底）。 */
  sha256: string | null
}

/** “以后再说”只针对该标签：记住被忽略的标签，更新的标签到来时仍会提示。 */
const DISMISSED_KEY = 'chat-demo:dismissed-update-tag'

const readDismissedTag = (): string | null => {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

type UpdateState = {
  latestRelease: AvailableRelease | null
  dialogOpen: boolean
  dismissedTag: string | null
}

export const useUpdateStore = create<UpdateState>(() => ({
  latestRelease: null,
  dialogOpen: false,
  dismissedTag: readDismissedTag(),
}))

export const openUpdateDialog = (release: AvailableRelease): void => {
  useUpdateStore.setState({ latestRelease: release, dialogOpen: true })
}

export const closeUpdateDialog = (): void => {
  useUpdateStore.setState({ dialogOpen: false })
}

export const dismissUpdate = (tag: string): void => {
  try {
    localStorage.setItem(DISMISSED_KEY, tag)
  } catch {
    // 存储不可用时只在内存里忽略本次提示。
  }
  useUpdateStore.setState({ dismissedTag: tag, dialogOpen: false })
}

/**
 * 从 Release 正文解析 APK SHA256：取 "SHA256" 之后第一串 64 位十六进制（大小写不敏感）。
 * 我们的 Release 正文包含 `APK SHA256: <64 hex>` 一行；解析不到返回 null。
 */
export const parseReleaseSha256 = (body: string): string | null => {
  const match = /SHA256[^0-9A-Fa-f]{0,20}([0-9A-Fa-f]{64})/i.exec(body)
  return match ? match[1].toLowerCase() : null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

type ReleasePayload = {
  tag: string
  htmlUrl: string
  body: string
  assets: { name: string; url: string }[]
}

const parseReleasePayload = (value: unknown): ReleasePayload | null => {
  const obj = asRecord(value)
  if (!obj) {
    return null
  }
  const tag = obj['tag_name']
  const htmlUrl = obj['html_url']
  const body = obj['body']
  const assets = obj['assets']
  if (typeof tag !== 'string' || !tag || typeof htmlUrl !== 'string' || !htmlUrl) {
    return null
  }
  if (!Array.isArray(assets)) {
    return null
  }
  const parsedAssets: { name: string; url: string }[] = []
  for (const asset of assets) {
    const record = asRecord(asset)
    const name = record?.['name']
    const url = record?.['browser_download_url']
    if (typeof name === 'string' && typeof url === 'string' && name && url) {
      parsedAssets.push({ name, url })
    }
  }
  return { tag, htmlUrl, body: typeof body === 'string' ? body : '', assets: parsedAssets }
}

export type CheckResult = 'newer' | 'current' | 'no-apk' | 'error'

let checking: Promise<CheckResult> | null = null

/**
 * 检查更新：拉取 releases/latest（排除 pre-release）。api.github.com 的请求永不走代理。
 * manual=false（启动自动检查）时：已忽略的标签不弹窗，失败静默；
 * manual=true（设置里手动检查）时：忽略记录也要弹窗，调用方按返回值 toast。
 * 并发调用共用同一次请求。
 */
export const checkForUpdate = (manual: boolean): Promise<CheckResult> => {
  if (checking) {
    return checking
  }
  checking = (async (): Promise<CheckResult> => {
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 15_000)
      let payload: unknown
      try {
        const response = await fetch(RELEASES_LATEST_URL, {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json' },
        })
        if (!response.ok) {
          return 'error'
        }
        payload = await response.json()
      } finally {
        window.clearTimeout(timer)
      }
      const parsed = parseReleasePayload(payload)
      if (!parsed) {
        return 'error'
      }
      if (!isNewerVersion(parsed.tag, APP_VERSION)) {
        return 'current'
      }
      const apk = parsed.assets.find((asset) => asset.name.toLowerCase().endsWith('.apk'))
      if (!apk) {
        return 'no-apk'
      }
      const release: AvailableRelease = {
        tag: parsed.tag,
        htmlUrl: parsed.htmlUrl,
        apkUrl: apk.url,
        apkName: apk.name,
        sha256: parseReleaseSha256(parsed.body),
      }
      useUpdateStore.setState({ latestRelease: release })
      if (manual || useUpdateStore.getState().dismissedTag !== parsed.tag) {
        useUpdateStore.setState({ dialogOpen: true })
      }
      return 'newer'
    } catch {
      return 'error'
    }
  })().finally(() => {
    checking = null
  })
  return checking
}
