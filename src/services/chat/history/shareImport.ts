import { CapacitorHttp } from '@capacitor/core'
import * as db from '../db.js'
import { addImportedSession } from '../store.js'
import { BackupError } from './errors.js'
import {
  ShareImportError,
  adaptShareToSessionFile,
  parseShareId,
  type ShareFileDownload,
} from './shareFormat.js'
import { toLocalSession } from './toLocal.js'

export { ShareImportError } from './shareFormat.js'

/**
 * 从 DeepSeek 网页版分享链接导入对话。
 *
 * 分享接口是公开的匿名接口，无需登录：
 *   GET https://chat.deepseek.com/api/v0/share/content?share_id=<id>
 * 结构适配见 shareFormat.ts，转换复用 toLocalSession，不再写第二套转换器。
 * 分享内容只发往 chat.deepseek.com（取分享 + 下载附件），不上传任何本地内容。
 */

const SHARE_ORIGIN = 'https://chat.deepseek.com'
const SHARE_API = `${SHARE_ORIGIN}/api/v0/share/content`

export type ShareImportPhase = 'fetch' | 'convert' | 'files' | 'save'

export type ShareImportProgress = {
  phase: ShareImportPhase
  /** files 阶段：已下载附件数；其余阶段为 0 */
  done: number
  /** files 阶段：附件总数；其余阶段为 0 */
  total: number
}

export type ShareImportResult = {
  sessionId: string
  title: string
  /** 导入的问答轮数（用户消息数） */
  turns: number
  /** 下载失败的附件数（只保留了文件名，不影响导入） */
  failedFiles: number
  /** 因父消息缺失、无法修复而丢弃的消息数 */
  droppedMessages: number
}

const fetchShareJson = async (shareId: string): Promise<unknown> => {
  const url = `${SHARE_API}?share_id=${encodeURIComponent(shareId)}`
  // 原生走 CapacitorHttp（绕过 WebView CORS），网页端走同源 fetch；两种都失败才报网络错误。
  try {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'json',
      connectTimeout: 15000,
      readTimeout: 60000,
    })
    if (response.status === 404) {
      throw new ShareImportError('shareImportNotFound')
    }
    if (response.status !== 200) {
      throw new ShareImportError('shareImportFailed')
    }
    return response.data as unknown
  } catch (error) {
    if (error instanceof ShareImportError) {
      throw error
    }
    try {
      const response = await fetch(url)
      if (response.status === 404) {
        throw new ShareImportError('shareImportNotFound')
      }
      if (!response.ok) {
        throw new ShareImportError('shareImportFailed')
      }
      return (await response.json()) as unknown
    } catch (fallbackError) {
      if (fallbackError instanceof ShareImportError) {
        throw fallbackError
      }
      throw new ShareImportError('shareImportNetworkError')
    }
  }
}

const sniffMimeType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  return ''
}

/** 原生 CapacitorHttp 的 arraybuffer 以 base64 字符串返回，网页端返回 ArrayBuffer。 */
const toBlob = (data: unknown): Blob | null => {
  try {
    if (data instanceof Blob) {
      return data
    }
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data)
      return new Blob([bytes], { type: sniffMimeType(bytes) })
    }
    if (typeof data === 'string') {
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new Blob([bytes], { type: sniffMimeType(bytes) })
    }
  } catch {
    return null
  }
  return null
}

/**
 * 下载结果是否可用：签名过期时服务端返回 200 + HTML 提示页（不是文件本身），
 * 必须挡掉，否则会把一张 HTML 页存成附件原件。图片还要求内容确实是图片。
 */
export const isUsableDownload = (
  blob: Blob,
  isImage: boolean,
  contentType: string | null
): boolean => {
  if (contentType && contentType.toLowerCase().startsWith('text/html')) {
    return false
  }
  if (blob.size === 0) {
    return false
  }
  return !isImage || blob.type.startsWith('image/')
}

const headerValue = (
  headers: Record<string, string> | undefined,
  name: string
): string | null => {
  if (!headers) {
    return null
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return value
    }
  }
  return null
}

const downloadFile = async (file: ShareFileDownload): Promise<db.StoredFile | null> => {
  const url = `${SHARE_ORIGIN}${file.signedPath}`
  try {
    const response = await CapacitorHttp.get({ url, responseType: 'arraybuffer' })
    if (response.status !== 200) {
      return null
    }
    const blob = toBlob(response.data)
    if (!blob || !isUsableDownload(blob, file.isImage, headerValue(response.headers, 'content-type'))) {
      return null
    }
    return { id: file.id, blob }
  } catch {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        return null
      }
      const blob = await response.blob()
      if (!isUsableDownload(blob, file.isImage, response.headers.get('content-type'))) {
        return null
      }
      return { id: file.id, blob }
    } catch {
      return null
    }
  }
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 导入一条分享链接：取分享 → 适配转换 → 下载附件（单个失败不影响整体）→ 落库并选中。
 * 只新增一个会话，不动其他本地会话。
 */
export const importShareLink = async (
  input: string,
  onProgress?: (progress: ShareImportProgress) => void
): Promise<ShareImportResult> => {
  const shareId = parseShareId(input)
  if (!shareId) {
    throw new ShareImportError('shareImportInvalidLink')
  }
  onProgress?.({ phase: 'fetch', done: 0, total: 0 })
  const payload = await fetchShareJson(shareId)
  await yieldToUi()
  onProgress?.({ phase: 'convert', done: 0, total: 0 })
  const { file, downloads, dropped } = adaptShareToSessionFile(payload)
  let session
  try {
    session = toLocalSession(file).session
  } catch (error) {
    if (error instanceof BackupError) {
      throw new ShareImportError('shareImportFailed')
    }
    throw error
  }
  await yieldToUi()
  // 同一文件在多条消息里只下载一次；签名可能过期，导入时立即下载。
  const unique = [...new Map(downloads.map((item) => [item.id, item])).values()]
  const stored: db.StoredFile[] = []
  let failedFiles = 0
  for (let index = 0; index < unique.length; index++) {
    onProgress?.({ phase: 'files', done: index, total: unique.length })
    const result = await downloadFile(unique[index])
    if (result) {
      stored.push(result)
    } else {
      failedFiles += 1
    }
    await yieldToUi()
  }
  onProgress?.({ phase: 'files', done: unique.length, total: unique.length })
  onProgress?.({ phase: 'save', done: 0, total: 0 })
  await db.saveSession(session, stored)
  addImportedSession(session)
  return {
    sessionId: session.id,
    title: session.title,
    turns: session.messages.filter((message) => message.role === 'user').length,
    failedFiles,
    droppedMessages: dropped,
  }
}
