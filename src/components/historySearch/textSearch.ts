import type { Message, Session } from '../../services/chat/types.js'

/** 全局搜索最多展示的结果条数，避免长列表拖慢侧边栏。 */
export const MAX_GLOBAL_RESULTS = 50
/** 摘要在命中词前后各保留的字符数。 */
export const SNIPPET_CONTEXT = 30

/** 消息的可搜索原文：用户消息取正文与附件名；助手消息取全部文本块与思考块。 */
export const messageSearchableText = (message: Message): string => {
  if (message.role === 'user') {
    const names = message.files.map((file) => file.name).filter(Boolean).join(' ')
    return names ? `${message.content}\n${names}` : message.content
  }
  return message.blocks
    .map((block) => {
      if (block.type === 'text') {
        return block.text
      }
      if (block.type === 'thinking') {
        return block.thinking
      }
      return ''
    })
    .join('\n')
}

/**
 * 去掉 markdown 标记得到纯文本，供匹配与摘要使用：
 * 代码围栏只去标记留内容，链接与图片只留文字，标题/引用/列表标记与行内样式标记去掉。
 */
export const stripMarkdown = (markdown: string): string =>
  markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[>\s]*#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(\s*)([-*+]|\d+[.)])\s+/gm, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** 摘要的三段：命中词前、命中词、命中词后，配合省略号渲染。 */
export type Snippet = {
  before: string
  match: string
  after: string
  leadingEllipsis: boolean
  trailingEllipsis: boolean
}

export const makeSnippet = (
  plainText: string,
  hitIndex: number,
  queryLength: number,
  context = SNIPPET_CONTEXT
): Snippet => {
  const start = Math.max(0, hitIndex - context)
  const end = Math.min(plainText.length, hitIndex + queryLength + context)
  return {
    before: plainText.slice(start, hitIndex),
    match: plainText.slice(hitIndex, hitIndex + queryLength),
    after: plainText.slice(hitIndex + queryLength, end),
    leadingEllipsis: start > 0,
    trailingEllipsis: end < plainText.length,
  }
}

/** 大小写不敏感地找出全部命中位置（按小写后的索引，与原文按字符一一对应）。 */
const findHitIndices = (plainText: string, query: string): number[] => {
  const haystack = plainText.toLowerCase()
  const needle = query.toLowerCase()
  const indices: number[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) {
      break
    }
    indices.push(index)
    from = index + Math.max(1, needle.length)
  }
  return indices
}

/** 一条消息上的命中：只保留首次命中位置做摘要，计数用于说明，不参与排序。 */
export type MessageHit = {
  messageId: string
  role: Message['role']
  createdAt: number
  hitCount: number
  snippet: Snippet
}

/** 在一组消息里搜索，返回含命中词的消息（每条消息一条），保持原消息顺序。 */
export const searchMessages = (messages: Message[], query: string): MessageHit[] => {
  const needle = query.trim()
  if (!needle) {
    return []
  }
  const hits: MessageHit[] = []
  for (const message of messages) {
    const plainText = stripMarkdown(messageSearchableText(message))
    const indices = findHitIndices(plainText, needle)
    if (indices.length === 0) {
      continue
    }
    hits.push({
      messageId: message.id,
      role: message.role,
      createdAt: message.createdAt,
      hitCount: indices.length,
      snippet: makeSnippet(plainText, indices[0], needle.length),
    })
  }
  return hits
}

export type GlobalSearchResult = MessageHit & {
  sessionId: string
  sessionTitle: string
  sessionUpdatedAt: number
}

/**
 * 在全部会话里搜索：会话按更新时间倒序，会话内消息按时间倒序（先看到最近的内容），
 * 结果截断到 MAX_GLOBAL_RESULTS 条。
 */
export const searchAllSessions = (sessions: Session[], query: string): GlobalSearchResult[] => {
  const needle = query.trim()
  if (!needle) {
    return []
  }
  const results: GlobalSearchResult[] = []
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of ordered) {
    const messages = [...session.messages].sort((a, b) => b.createdAt - a.createdAt)
    for (const hit of searchMessages(messages, needle)) {
      results.push({
        ...hit,
        sessionId: session.id,
        sessionTitle: session.title,
        sessionUpdatedAt: session.updatedAt,
      })
      if (results.length >= MAX_GLOBAL_RESULTS) {
        return results
      }
    }
  }
  return results
}
