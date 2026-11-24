import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { translate } from '../../i18n/index.js'
import { formatDate } from '../../utils/format.js'
import { copyText } from '../../utils/clipboard.js'
import { useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import * as db from './db.js'
import { useChatStore } from './store.js'
import type { Message, Session, TextPart } from './types.js'

/**
 * 单条消息在导出文档中的纯文本内容：用户消息取 content；助手消息取全部文本块拼接，
 * 思考块与服务端工具块不导出（只导出最终呈现的回答正文）。
 */
const messageText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .filter((block): block is TextPart => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** 用户消息的附件只导出文件名（不含文件内容），附在正文之后。 */
const messageBody = (message: Message): string => {
  const text = messageText(message).trim()
  if (message.role === 'user' && message.files.length > 0) {
    const attachments = translate('sessionExportAttachments', {
      names: message.files.map((file) => file.name).join(', '),
    })
    return text ? `${text}\n\n${attachments}` : attachments
  }
  return text
}

/** 可导出的轮次：当前可见消息链上内容非空的轮次，Markdown / Word / HTML 共用。 */
type ExportTurn = { role: 'user' | 'assistant'; body: string }

const getExportTurns = (session: Session): ExportTurn[] => {
  const turns: ExportTurn[] = []
  for (const message of getVisibleMessages(session)) {
    const body = messageBody(message)
    if (!body) {
      continue
    }
    turns.push({ role: message.role, body })
  }
  return turns
}

const exportHeading = (role: ExportTurn['role']) =>
  translate(role === 'user' ? 'sessionExportUserHeading' : 'sessionExportAssistantHeading')

/**
 * 单个会话的 Markdown 文档：标题、日期，之后每轮按用户 / 助手分节。
 * 只取当前可见的消息链（分支的未选中版本不导出）。内容全空时返回 null。
 */
export const buildSessionMarkdown = (session: Session): string | null => {
  const turns = getExportTurns(session)
  if (turns.length === 0) {
    return null
  }
  const title = session.title || translate('untitledChat')
  const date = new Date(session.createdAt).toLocaleString(useSettings.getState().locale)
  const lines = [`# ${title}`, '', `${translate('sessionExportDate')}：${date}`]
  for (const turn of turns) {
    lines.push('', `## ${exportHeading(turn.role)}`, '', turn.body)
  }
  return lines.join('\n')
}

const loadExportSession = async (sessionId: string): Promise<Session | undefined> => {
  const { sessionCache } = useChatStore.getState()
  return Object.hasOwn(sessionCache, sessionId)
    ? sessionCache[sessionId]
    : await db.loadSession(sessionId)
}

export type SessionExportResult = 'copied' | 'copyFailed' | 'empty' | 'notFound'

/**
 * 导出单个会话：生成 Markdown 后复制到剪贴板（未引入分享插件时，
 * 剪贴板 + 提示是约定的分享路径，用户可粘贴到任意应用）。
 * 已加载的会话直接取缓存，未打开的会话从本地数据库读取，不填满详情缓存。
 */
export const exportSessionMarkdown = async (sessionId: string): Promise<SessionExportResult> => {
  try {
    const session = await loadExportSession(sessionId)
    if (!session) {
      return 'notFound'
    }
    const markdown = buildSessionMarkdown(session)
    if (markdown === null) {
      return 'empty'
    }
    return (await copyText(markdown)) ? 'copied' : 'copyFailed'
  } catch {
    return 'copyFailed'
  }
}

/** 导出文件名：标题（去非法字符、限长）+ 日期；标题为空时用「新对话」。 */
const exportFileName = (session: Session, extension: string): string => {
  const raw = session.title || translate('untitledChat')
  const title =
    raw
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat'
  const date = formatDate(new Date(session.createdAt), '-') ?? ''
  return `${title}-${date}.${extension}`
}

const downloadBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file as base64'))
        return
      }
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as base64'))
    reader.readAsDataURL(blob)
  })

/**
 * 系统分享：原生走 @capacitor/share 分享 Markdown 文本（可发到微信、QQ 等任意应用）；
 * 网页端用系统 navigator.share，不支持时退回复制到剪贴板。内容不上传任何服务器。
 */
export type SessionShareResult = 'shared' | 'cancelled' | 'copyFailed' | 'empty' | 'notFound'

export const shareSessionMarkdown = async (sessionId: string): Promise<SessionShareResult> => {
  try {
    const session = await loadExportSession(sessionId)
    if (!session) {
      return 'notFound'
    }
    const markdown = buildSessionMarkdown(session)
    if (markdown === null) {
      return 'empty'
    }
    const title = session.title || translate('untitledChat')
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text: markdown, dialogTitle: title })
      return 'shared'
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text: markdown })
      return 'shared'
    }
    return (await copyText(markdown)) ? 'shared' : 'copyFailed'
  } catch (error) {
    // 用户在系统分享里点取消：不算失败，不弹错。
    return error instanceof DOMException && error.name === 'AbortError'
      ? 'cancelled'
      : 'copyFailed'
  }
}

/** 正文按行切分：``` 围起来的按等宽代码段处理，其余按普通段落处理。 */
const textToDocxParagraphs = (body: string): Paragraph[] => {
  const paragraphs: Paragraph[] = []
  let inCode = false
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })],
        })
      )
    } else {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: line || ' ' })] }))
    }
  }
  return paragraphs
}

/**
 * Word 文档：标题一级标题、日期斜体、每轮用户 / 助手二级标题，代码块等宽字体。
 * 返回 Blob；内容全空时返回 null。
 */
export const buildSessionDocx = async (session: Session): Promise<Blob | null> => {
  const turns = getExportTurns(session)
  if (turns.length === 0) {
    return null
  }
  const title = session.title || translate('untitledChat')
  const date = new Date(session.createdAt).toLocaleString(useSettings.getState().locale)
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${translate('sessionExportDate')}：${date}`,
          italics: true,
        }),
      ],
    }),
  ]
  for (const turn of turns) {
    children.push(
      new Paragraph({ text: exportHeading(turn.role), heading: HeadingLevel.HEADING_2 }),
      ...textToDocxParagraphs(turn.body)
    )
  }
  return Packer.toBlob(new Document({ sections: [{ children }] }))
}

export type SessionDocxExportResult =
  | 'saved'
  | 'downloaded'
  | 'failed'
  | 'empty'
  | 'notFound'

/**
 * Word 文档存到本机：原生写到系统 Documents 目录并返回保存位置；
 * 网页端直接下载文件。内容不上传任何服务器。
 */
export const exportSessionDocx = async (
  sessionId: string
): Promise<{ result: SessionDocxExportResult; path?: string }> => {
  try {
    const session = await loadExportSession(sessionId)
    if (!session) {
      return { result: 'notFound' }
    }
    const blob = await buildSessionDocx(session)
    if (!blob) {
      return { result: 'empty' }
    }
    const name = exportFileName(session, 'docx')
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: name,
        data: await blobToBase64(blob),
        directory: Directory.Documents,
        recursive: true,
      })
      return { result: 'saved', path: uri }
    }
    downloadBlob(blob, name)
    return { result: 'downloaded', path: name }
  } catch {
    return { result: 'failed' }
  }
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 正文转 HTML：空行分段、行内换行、``` 代码块，全部内联样式、不引用外部资源。 */
const bodyToHtml = (body: string): string => {
  const lines = body.split('\n')
  const out: string[] = []
  let inCode = false
  let code: string[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${para.map(escapeHtml).join('<br>')}</p>`)
      para = []
    }
  }
  const flushCode = () => {
    if (code.length > 0) {
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      code = []
    }
  }
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushPara()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(line)
    } else if (line.trim() === '') {
      flushPara()
    } else {
      para.push(line)
    }
  }
  flushCode()
  flushPara()
  return out.join('\n')
}

/**
 * 独立 HTML 对话记录：自包含、内联 CSS、无外部资源，可直接用浏览器打开，
 * 也可通过系统分享发给其他应用。内容全空时返回 null。
 */
export const buildSessionHtml = (session: Session): string | null => {
  const turns = getExportTurns(session)
  if (turns.length === 0) {
    return null
  }
  const title = session.title || translate('untitledChat')
  const date = new Date(session.createdAt).toLocaleString(useSettings.getState().locale)
  const lang = useSettings.getState().locale === 'en-US' ? 'en' : 'zh-CN'
  const sections = turns
    .map(
      (turn) =>
        `<section>\n<h2>${escapeHtml(exportHeading(turn.role))}</h2>\n${bodyToHtml(turn.body)}\n</section>`
    )
    .join('\n')
  return `<!DOCTYPE html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>body{margin:0 auto;max-width:720px;padding:24px 16px;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f1f1f;background:#fff}h1{font-size:22px;line-height:1.4}h2{font-size:17px;margin:28px 0 8px;color:#0b57d0}p{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:break-word}pre{background:#f2f2f2;border-radius:8px;padding:12px;overflow:auto}pre code{font:13px/1.6 Consolas,Menlo,monospace}.meta{color:#666;font-size:14px}section{border-top:1px solid #e5e5e5;padding-top:4px}</style>\n</head>\n<body>\n<h1>${escapeHtml(title)}</h1>\n<p class="meta">${escapeHtml(translate('sessionExportDate'))}：${escapeHtml(date)}</p>\n${sections}\n</body>\n</html>\n`
}

export type SessionHtmlExportResult =
  | 'shared'
  | 'downloaded'
  | 'cancelled'
  | 'failed'
  | 'empty'
  | 'notFound'

/**
 * HTML 文件：原生先写到缓存目录，再用系统分享发给其他应用；
 * 网页端直接下载文件。内容不上传任何服务器。
 */
export const exportSessionHtml = async (
  sessionId: string
): Promise<{ result: SessionHtmlExportResult; path?: string }> => {
  try {
    const session = await loadExportSession(sessionId)
    if (!session) {
      return { result: 'notFound' }
    }
    const html = buildSessionHtml(session)
    if (html === null) {
      return { result: 'empty' }
    }
    const name = exportFileName(session, 'html')
    const title = session.title || translate('untitledChat')
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: name,
        data: html,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      })
      await Share.share({ title, dialogTitle: title, files: [uri] })
      return { result: 'shared', path: uri }
    }
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), name)
    return { result: 'downloaded', path: name }
  } catch (error) {
    // 用户在系统分享里点取消：文件已写入缓存，不算失败，不弹错。
    return error instanceof DOMException && error.name === 'AbortError'
      ? { result: 'cancelled' }
      : { result: 'failed' }
  }
}
