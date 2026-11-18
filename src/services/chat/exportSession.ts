import { translate } from '../../i18n/index.js'
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

/**
 * 单个会话的 Markdown 文档：标题、日期，之后每轮按用户 / 助手分节。
 * 只取当前可见的消息链（分支的未选中版本不导出）。内容全空时返回 null。
 */
export const buildSessionMarkdown = (session: Session): string | null => {
  const title = session.title || translate('untitledChat')
  const date = new Date(session.createdAt).toLocaleString(useSettings.getState().locale)
  const lines = [`# ${title}`, '', `${translate('sessionExportDate')}：${date}`]
  let exported = 0
  for (const message of getVisibleMessages(session)) {
    const body = messageBody(message)
    if (!body) {
      continue
    }
    exported += 1
    lines.push(
      '',
      `## ${translate(message.role === 'user' ? 'sessionExportUserHeading' : 'sessionExportAssistantHeading')}`,
      '',
      body
    )
  }
  return exported === 0 ? null : lines.join('\n')
}

export type SessionExportResult = 'copied' | 'copyFailed' | 'empty' | 'notFound'

/**
 * 导出单个会话：生成 Markdown 后复制到剪贴板（未引入分享插件时，
 * 剪贴板 + 提示是约定的分享路径，用户可粘贴到任意应用）。
 * 已加载的会话直接取缓存，未打开的会话从本地数据库读取，不填满详情缓存。
 */
export const exportSessionMarkdown = async (sessionId: string): Promise<SessionExportResult> => {
  try {
    const { sessionCache } = useChatStore.getState()
    const session = Object.hasOwn(sessionCache, sessionId)
      ? sessionCache[sessionId]
      : await db.loadSession(sessionId)
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
