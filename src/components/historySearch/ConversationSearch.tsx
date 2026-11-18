import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { Session } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconSearchOutline16,
} from '../base/icons.js'
import {
  clearMessageHighlights,
  markCurrentMessage,
  scrollToMessageAsCurrent,
} from './highlight.js'
import { searchMessages } from './textSearch.js'
import './highlight.css'
import styles from './ConversationSearch.module.css'

/**
 * 当前对话内搜索：只搜打开的会话当前分支的消息，支持上一个/下一个导航与命中计数。
 * 计数按含命中词的消息条数（不是命中词出现次数），与滚动定位一一对应。
 */
export const ConversationSearch = ({
  session,
  onClose,
}: {
  session: Session
  onClose: () => void
}) => {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const scrolledIdRef = useRef<string | null>(null)

  const hits = useMemo(
    () => searchMessages(getVisibleMessages(session), query),
    [session, query]
  )
  const current = hits.length > 0 ? Math.min(index, hits.length - 1) : 0
  const currentHit = hits[current]

  useEffect(() => {
    setIndex(0)
  }, [query])

  // 退出搜索（卸载）时清除高亮。
  useEffect(() => () => clearMessageHighlights(), [])

  // 当前命中变化时滚动并高亮；同一条消息反复命中（如流式更新）时只补高亮不重复滚动。
  useEffect(() => {
    if (!currentHit) {
      scrolledIdRef.current = null
      clearMessageHighlights()
      return
    }
    if (scrolledIdRef.current === currentHit.messageId) {
      markCurrentMessage(currentHit.messageId)
      return
    }
    scrolledIdRef.current = currentHit.messageId
    scrollToMessageAsCurrent(currentHit.messageId)
  }, [currentHit])

  const goTo = (delta: number) => {
    if (hits.length === 0) {
      return
    }
    setIndex((current + delta + hits.length) % hits.length)
  }

  const trimmed = query.trim()
  const counter = !trimmed
    ? ''
    : hits.length === 0
      ? t('inChatSearchNoResults')
      : t('inChatSearchCounter', { current: current + 1, total: hits.length })

  return (
    <div className={styles.bar}>
      <div className={styles.box}>
        <span className={styles.icon}>
          <IconSearchOutline16 />
        </span>
        <input
          className={styles.input}
          type="text"
          autoComplete="off"
          autoFocus
          value={query}
          placeholder={t('inChatSearchPlaceholder')}
          aria-label={t('inChatSearchPlaceholder')}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              goTo(event.shiftKey ? -1 : 1)
            } else if (event.key === 'Escape') {
              onClose()
            }
          }}
        />
      </div>
      <span className={styles.counter}>{counter}</span>
      <IconButton
        size="xs"
        icon={
          <span className={styles.prevIcon}>
            <IconChevronDownOutline14 />
          </span>
        }
        tooltip={t('inChatSearchPrevious')}
        disabled={hits.length === 0}
        onClick={() => goTo(-1)}
      />
      <IconButton
        size="xs"
        icon={<IconChevronDownOutline14 />}
        tooltip={t('inChatSearchNext')}
        disabled={hits.length === 0}
        onClick={() => goTo(1)}
      />
      <IconButton
        size="xs"
        icon={<IconCloseOutline16 />}
        tooltip={t('close')}
        onClick={onClose}
      />
    </div>
  )
}
