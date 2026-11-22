import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { InputCollapseContext, ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'
import { useTranslate, type TranslationKey, type TranslationParams } from '../../i18n/index.js'
import { useSettings, type Locale } from '../../services/settings.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 离开底部的回滞：距底部超过 STICKY_THRESHOLD + 该值才视为离开底部。
 * 必须大于输入框展开与折叠的高度差（实测：空草稿约 200px，特大字号约 201px，
 * 长草稿 textarea 顶满 336px 上限时约 488px；再留附件行余量），否则折叠会撑大
 * 滚动区、触发 scrollTop 钳制事件把底部状态翻回 true 再展开，配合 ResizeObserver
 * 的 scrollToBottom 在慢速上滑时每步都闪烁一次并弹回底部。展开阈值仍是 STICKY_THRESHOLD。 */
const COLLAPSE_HYSTERESIS = 640
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/** 相邻消息间隔超过该值时插入时间分割线；首条消息前始终有一条 */
const TIME_DIVIDER_GAP = 5 * 60 * 1000
const DAY = 86_400_000

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 聊天式时间：今天只显示 HH:mm，昨天加“昨天”，更早显示日期 + 时间。 */
const formatDividerTime = (
  createdAt: number,
  locale: Locale,
  t: (key: TranslationKey, params?: TranslationParams) => string
): string => {
  const date = new Date(createdAt)
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const startOfDay = new Date(createdAt).setHours(0, 0, 0, 0)
  const dayDiff = Math.round((startOfToday - startOfDay) / DAY)
  if (dayDiff <= 0) {
    return time
  }
  if (dayDiff === 1) {
    return t('messageTimeYesterday', { time })
  }
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = 'numeric'
  }
  const datePart = new Intl.DateTimeFormat(locale, options).format(date)
  return `${datePart} ${time}`
}

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  // 底部状态外露给输入框做自动折叠：只在翻转时 setState，避免滚动中反复渲染。
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isAtBottomRef = useRef(true)
  const collapseValue = useMemo(() => ({ isAtBottom }), [isAtBottom])
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    isAtBottomRef.current = true
    setIsAtBottom(true)
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const nearBottom = distance < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      // 底部状态用回滞判断，供输入框自动折叠 / 展开：回到 40px 内展开，
      // 只有上滑到 40 + 640px 外才折叠。折叠后距底部仍大于 40px，且折叠时
      // scrollTop 不会被钳制（distance 大于高度差），不会翻回展开。
      const nextAtBottom = nearBottom
        ? true
        : distance > STICKY_THRESHOLD + COLLAPSE_HYSTERESIS &&
            el.scrollTop < scrollTopRef.current
          ? false
          : isAtBottomRef.current
      if (nextAtBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = nextAtBottom
        setIsAtBottom(nextAtBottom)
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {messages.map((message, index) => {
              const previous = messages[index - 1]
              const showDivider =
                index === 0 ||
                message.createdAt - (previous?.createdAt ?? message.createdAt) >
                  TIME_DIVIDER_GAP
              return (
                <Fragment key={message.id}>
                  {showDivider ? (
                    <div className={styles.timeDivider}>
                      {formatDividerTime(message.createdAt, locale, t)}
                    </div>
                  ) : null}
                  {/* 搜索跳转锚点：data-message-id 供 historySearch 按 DOM 定位与高亮。*/}
                  <div data-message-id={message.id}>
                    {message.role === 'user' ? (
                      <UserMessage
                        sessionId={session.id}
                        message={message}
                        retryUploadId={uploadRetryId}
                        isFirst={index === 0}
                        isLast={index === lastIndex || index === lastIndex - 1}
                        busy={streaming}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                      />
                    ) : (
                      <AssistantMessage
                        sessionId={session.id}
                        message={message}
                        isLast={index === lastIndex}
                        streaming={streaming && index === lastIndex}
                        busy={streaming}
                        versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                        onSelectVersion={selectVersion}
                      />
                    )}
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
        <InputCollapseContext.Provider value={collapseValue}>
          {footer}
        </InputCollapseContext.Provider>
      </div>
    </ScrollToBottomContext.Provider>
  )
}
