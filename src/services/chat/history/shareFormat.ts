import { createId } from '../../../utils/id.js'
import type { TranslationKey } from '../../../i18n/index.js'
import type {
  ChatMessage,
  ChatMessageStatus,
  FileEntry,
  Fragment,
  SearchResult,
  SessionFile,
  ToolOpenFragment,
  ToolSearchFragment,
} from './format.js'

/**
 * 分享 JSON → 归档 SessionFile 的纯适配层（不碰网络与存储，可单独测试）。
 *
 * 分享与归档的差异都在这里抹平：
 * - 时间是 UNIX 纪元秒（可能带小数），归档是 ISO 字符串；
 * - TOOL_SEARCH 的 queries 是 [{query}] 对象数组，归档是字符串数组；
 * - TOOL_OPEN 的结果包在 result 里（没有时为 null），归档是平铺字段；
 * - SEARCH 与 TOOL_SEARCH 同形，都按搜索片段导入；
 * - FILE 的 id 带 file- 前缀，归档是不带前缀的裸 UUID；export_path 缺失，
 *   附件原件走下载步骤，不走 ZIP 路径；
 * - 不能映射的片段（TIP 免责声明、TOOL_IMAGE_SEARCH 等）直接丢弃。
 */

/** 导入失败的原因，直接对应界面文案 key。 */
export class ShareImportError extends Error {
  constructor(readonly key: TranslationKey) {
    super(key)
    this.name = 'ShareImportError'
  }
}

/** 接受完整分享链接或裸分享 ID。 */
export const parseShareId = (input: string): string | null => {
  const text = input.trim()
  if (!text) {
    return null
  }
  const fromUrl = /chat\.deepseek\.com\/share\/([A-Za-z0-9_-]+)/.exec(text)?.[1]
  if (fromUrl) {
    return fromUrl
  }
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asBoolean = (value: unknown): boolean => value === true

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** 分享里的时间是 UNIX 纪元秒（可能带小数），归档用 ISO 字符串。 */
const epochToIso = (value: unknown): string => {
  const seconds = asNumber(value, NaN)
  if (!Number.isFinite(seconds)) {
    return new Date(0).toISOString()
  }
  return new Date(seconds * 1000).toISOString()
}

const epochToIsoOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  const seconds = asNumber(value, NaN)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null
}

const messageStatus = (value: unknown): ChatMessageStatus => {
  const known: ChatMessageStatus[] = [
    'WIP',
    'FINISHED',
    'CONTENT_FILTER',
    'FAILED',
    'INCOMPLETE',
    'CONTEXT_LENGTH_EXCEEDED',
    'TIMEOUT',
  ]
  return typeof value === 'string' && (known as string[]).includes(value)
    ? (value as ChatMessageStatus)
    : 'FINISHED'
}

const searchStatus = (value: unknown): 'WIP' | 'FINISHED' | 'FAILED' | undefined =>
  value === 'WIP' || value === 'FINISHED' || value === 'FAILED' ? value : undefined

/** 分享的 queries 是 [{query}] 对象数组，归档是字符串数组。 */
const toQueries = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) =>
    typeof item === 'string'
      ? [item]
      : isRecord(item) && typeof item.query === 'string'
        ? [item.query]
        : []
  )
}

/** 分享的 published_at 是纪元秒，归档是 ISO 字符串或 null。 */
const toSearchResult = (value: unknown): SearchResult | null => {
  if (!isRecord(value) || typeof value.url !== 'string') {
    return null
  }
  return {
    url: value.url,
    title: asString(value.title),
    snippet: asString(value.snippet),
    published_at: epochToIsoOrNull(value.published_at),
    site_name: typeof value.site_name === 'string' ? value.site_name : null,
    ...(typeof value.site_icon === 'string' ? { site_icon: value.site_icon } : {}),
  }
}

const toSearchResults = (value: unknown): SearchResult[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    const result = toSearchResult(item)
    return result ? [result] : []
  })
}

export type ShareFileDownload = {
  /** 归档风格的裸 UUID（去掉 file- 前缀），与 FileAttachment id / IndexedDB blob key 一致 */
  id: string
  signedPath: string
  name: string
  isImage: boolean
}

const toFileEntry = (
  value: unknown,
  downloads: ShareFileDownload[]
): FileEntry | null => {
  if (!isRecord(value)) {
    return null
  }
  // 分享的文件 id 带 file- 前缀，归档是不带前缀的裸 UUID；统一用裸 UUID。
  const rawId = asString(value.id)
  const id = rawId.startsWith('file-') ? rawId.slice('file-'.length) : rawId
  if (!id) {
    return null
  }
  const signedPath = asString(value.signed_path)
  if (signedPath) {
    downloads.push({
      id,
      signedPath,
      name: asString(value.file_name),
      isImage: asBoolean(value.is_image),
    })
  }
  return {
    id,
    file_name: asString(value.file_name),
    file_size: asNumber(value.file_size),
    token_usage: typeof value.token_usage === 'number' ? value.token_usage : null,
    inserted_at: epochToIso(value.inserted_at),
    // 分享没有 export_path；附件原件走下载步骤，不走 ZIP 路径。
    export_path: null,
    is_image: asBoolean(value.is_image),
    width: typeof value.width === 'number' ? value.width : null,
    height: typeof value.height === 'number' ? value.height : null,
  }
}

/**
 * 分享片段 → 归档片段。不能映射的片段直接丢弃（TIP 免责声明、TOOL_IMAGE_SEARCH 等），
 * 不影响正文与搜索结果的导入。
 */
const toFragment = (value: unknown, downloads: ShareFileDownload[]): Fragment | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }
  switch (value.type) {
    case 'REQUEST':
      return { type: 'REQUEST', content: asString(value.content) }
    case 'RESPONSE':
      return { type: 'RESPONSE', content: asString(value.content) }
    case 'THINK':
      return {
        type: 'THINK',
        content: asString(value.content),
        elapsed_secs: typeof value.elapsed_secs === 'number' ? value.elapsed_secs : null,
      }
    case 'TEMPLATE_RESPONSE':
      return { type: 'TEMPLATE_RESPONSE', content: asString(value.content) }
    case 'TIP':
      return {
        type: 'TIP',
        content: asString(value.content),
        style: value.style === 'WARNING' || value.style === 'CAUTION' ? value.style : 'INFO',
      }
    case 'CONTENT_RISK':
      return {
        type: 'CONTENT_RISK',
        content: asString(value.content),
        style: value.style === 'WARNING' || value.style === 'CAUTION' ? value.style : 'INFO',
      }
    case 'PARTIAL_FILE_READ':
      return { type: 'PARTIAL_FILE_READ', ratio: asNumber(value.ratio) }
    case 'TOOL_SEARCH':
    case 'SEARCH': {
      // SEARCH 与 TOOL_SEARCH 同形（queries + results），都按搜索片段导入。
      const fragment: ToolSearchFragment = {
        type: 'TOOL_SEARCH',
        queries: toQueries(value.queries),
        results: toSearchResults(value.results),
      }
      const status = searchStatus(value.status)
      if (status) {
        fragment.status = status
      }
      return fragment
    }
    case 'TOOL_OPEN': {
      // 分享的打开结果包在 result 里（没有 url/title 时 result 为 null），归档是平铺字段。
      const result = isRecord(value.result) ? value.result : null
      const fragment: ToolOpenFragment = {
        type: 'TOOL_OPEN',
        status:
          value.status === 'WIP' || value.status === 'FAILED' ? value.status : 'FINISHED',
        url: result && typeof result.url === 'string' ? result.url : null,
        title: result && typeof result.title === 'string' ? result.title : null,
        published_at: result ? epochToIsoOrNull(result.published_at) : null,
      }
      if (result && typeof result.snippet === 'string') {
        fragment.snippet = result.snippet
      }
      if (result && typeof result.site_name === 'string') {
        fragment.site_name = result.site_name
      }
      return fragment
    }
    case 'TOOL_FIND':
      return {
        type: 'TOOL_FIND',
        status:
          value.status === 'WIP' || value.status === 'NO_RESULT' || value.status === 'FAILED'
            ? value.status
            : 'FINISHED',
        ...(typeof value.pattern === 'string' ? { pattern: value.pattern } : {}),
      }
    case 'READ_LINK':
      return Array.isArray(value.results)
        ? {
            type: 'READ_LINK',
            results: value.results.flatMap((item) =>
              isRecord(item) && typeof item.signature === 'string'
                ? [
                    {
                      signature: item.signature,
                      ...(typeof item.url === 'string' ? { url: item.url } : {}),
                      ...(typeof item.title === 'string' || item.title === null
                        ? { title: item.title as string | null }
                        : {}),
                    },
                  ]
                : []
            ),
          }
        : null
    case 'FILE': {
      const files = Array.isArray(value.files)
        ? value.files.flatMap((item) => {
            const entry = toFileEntry(item, downloads)
            return entry ? [entry] : []
          })
        : []
      return files.length > 0 ? { type: 'FILE', files } : null
    }
    default:
      return null
  }
}

const toChatMessage = (
  value: unknown,
  downloads: ShareFileDownload[]
): ChatMessage | null => {
  if (!isRecord(value)) {
    return null
  }
  const id = value.message_id
  const role = value.role
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    (role !== 'USER' && role !== 'ASSISTANT')
  ) {
    return null
  }
  return {
    id,
    parent_id:
      typeof value.parent_id === 'number' && Number.isSafeInteger(value.parent_id)
        ? value.parent_id
        : null,
    role,
    status: messageStatus(value.status),
    thinking_enabled: asBoolean(value.thinking_enabled),
    search_enabled: asBoolean(value.search_enabled),
    accumulated_token_usage: asNumber(value.accumulated_token_usage),
    inserted_at: epochToIso(value.inserted_at),
    fragments: Array.isArray(value.fragments)
      ? value.fragments.flatMap((item) => {
          const fragment = toFragment(item, downloads)
          return fragment ? [fragment] : []
        })
      : [],
  }
}

/**
 * 修复消息链：toLocalSession 的 buildTree 要求父消息存在且角色交替，
 * 缺一个父消息就整个导入失败。分享链接可能只含部分消息（创建分享时未全选），
 * 所以先修复：父消息缺失时挂到最近的前一条异性角色消息上；实在挂不上的消息
 * （及其后代）丢弃并计数。
 */
export const repairChain = (
  messages: ChatMessage[]
): { messages: ChatMessage[]; dropped: number } => {
  const sorted = [...messages].sort((a, b) => a.id - b.id)
  const kept: ChatMessage[] = []
  const keptById = new Map<number, ChatMessage>()
  let dropped = 0
  for (const message of sorted) {
    if (keptById.has(message.id)) {
      dropped += 1
      continue
    }
    const parent = message.parent_id === null ? undefined : keptById.get(message.parent_id)
    const parentMissing = message.parent_id !== null && !parent
    const roleClash = parent !== undefined && parent.role === message.role
    const rootNotUser = message.parent_id === null && message.role !== 'USER'
    if (parentMissing || roleClash || rootNotUser) {
      if (message.role === 'USER' && parentMissing && kept.length === 0) {
        // 分享的第一条消息就是提问：没有可挂的前文时，它自己成为新的根。
        // 链中间的提问绝不能另起根（会把前面的对话挤出可见分支），只能挂到前一条助手消息上。
        message.parent_id = null
      } else {
        // 最近的前一条异性角色消息；没有时丢弃。
        const opposite = [...kept].reverse().find((item) => item.role !== message.role)
        if (!opposite) {
          dropped += 1
          continue
        }
        message.parent_id = opposite.id
      }
    }
    kept.push(message)
    keptById.set(message.id, message)
  }
  return { messages: kept, dropped }
}

/** 从首条用户提问截取标题；没有提问时用分享自带的标题，都没有则为空（显示为「新对话」）。 */
const deriveTitle = (messages: ChatMessage[], fallback: string): string => {
  const firstUser = messages.find((message) => message.role === 'USER')
  const firstRequest = firstUser?.fragments.find(
    (item): item is Extract<Fragment, { type: 'REQUEST' }> => item.type === 'REQUEST'
  )
  const text = firstRequest?.content.trim() || fallback.trim()
  if (!text) {
    return ''
  }
  const singleLine = text.replace(/\s+/g, ' ')
  return singleLine.length > 30 ? `${singleLine.slice(0, 30)}…` : singleLine
}

export type AdaptedShare = {
  file: SessionFile
  downloads: ShareFileDownload[]
  dropped: number
}

/** 分享 JSON → 归档 SessionFile；只做结构适配，转换复用 toLocalSession。 */
export const adaptShareToSessionFile = (payload: unknown): AdaptedShare => {
  if (
    !isRecord(payload) ||
    payload.code !== 0 ||
    !isRecord(payload.data) ||
    !isRecord(payload.data.biz_data)
  ) {
    throw new ShareImportError('shareImportNotFound')
  }
  const biz = payload.data.biz_data
  if (!Array.isArray(biz.messages) || biz.messages.length === 0) {
    throw new ShareImportError('shareImportEmpty')
  }
  const downloads: ShareFileDownload[] = []
  const parsed = biz.messages.flatMap((item) => {
    const message = toChatMessage(item, downloads)
    return message ? [message] : []
  })
  if (parsed.length === 0) {
    throw new ShareImportError('shareImportEmpty')
  }
  const { messages, dropped } = repairChain(parsed)
  if (messages.length === 0) {
    throw new ShareImportError('shareImportEmpty')
  }
  const title = deriveTitle(messages, asString(biz.title))
  const first = messages[0]
  const last = messages[messages.length - 1]
  return {
    file: {
      id: createId(),
      title: title || null,
      pinned: false,
      current_message_id: last.id,
      inserted_at: first.inserted_at,
      updated_at: last.inserted_at,
      messages,
    },
    downloads,
    dropped,
  }
}
