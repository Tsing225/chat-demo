import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16, IconSearchOutline16 } from '../base/icons.js'
import { loadAllSessions, reportStorageError } from '../../services/chat/db.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import { requestJumpToMessage } from './jumpTarget.js'
import { searchAllSessions, type GlobalSearchResult } from './textSearch.js'
import './highlight.css'
import styles from './GlobalSearch.module.css'

/** 输入停顿多久后执行搜索，避免每敲一个字都读一次 IndexedDB。 */
const DEBOUNCE_MS = 200

/**
 * 全局搜索：搜全部会话的全部消息正文（去 markdown 后大小写不敏感匹配）。
 * 首次有查询时才把全部会话读进内存，列表变化（新增/删除/重命名）时失效重读。
 */
export const GlobalSearch = () => {
  const t = useTranslate()
  const summaries = useChatStore((state) => state.sessions)
  const sessionsKey = useMemo(
    () => summaries.map((session) => `${session.id}:${session.updatedAt}`).join(','),
    [summaries]
  )
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const cacheRef = useRef<{ key: string; sessions: Session[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const needle = debouncedQuery.trim()
    if (!needle) {
      setResults([])
      setSearching(false)
      setSearched(false)
      return
    }
    let cancelled = false
    setSearching(true)
    void (async () => {
      try {
        const cached = cacheRef.current
        const sessions =
          cached && cached.key === sessionsKey
            ? cached.sessions
            : await loadAllSessions().then((loaded) => {
                cacheRef.current = { key: sessionsKey, sessions: loaded }
                return loaded
              })
        if (cancelled) {
          return
        }
        setResults(searchAllSessions(sessions, needle))
        setSearched(true)
      } catch (error) {
        reportStorageError('search sessions')(error)
        if (!cancelled) {
          setResults([])
          setSearched(true)
        }
      } finally {
        if (!cancelled) {
          setSearching(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, sessionsKey])

  const showPanel = query.trim() !== ''
  const clearQuery = () => {
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <div className={styles.container}>
      <div className={styles.box}>
        <span className={styles.icon}>
          <IconSearchOutline16 />
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          autoComplete="off"
          value={query}
          placeholder={t('historySearchPlaceholder')}
          aria-label={t('historySearchPlaceholder')}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              event.currentTarget.blur()
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className={styles.clearButton}
            aria-label={t('close')}
            onClick={clearQuery}
          >
            <IconCloseOutline16 />
          </button>
        ) : null}
      </div>
      {showPanel ? (
        <div className={styles.panel}>
          {searching && results.length === 0 ? (
            <div className={styles.status}>{t('historySearchSearching')}</div>
          ) : searched && !searching && results.length === 0 ? (
            <div className={styles.status}>{t('historySearchNoResults')}</div>
          ) : (
            results.map((result) => (
              <button
                key={`${result.sessionId}:${result.messageId}`}
                type="button"
                className={styles.result}
                onClick={() => {
                  selectSession(result.sessionId)
                  requestJumpToMessage(result.sessionId, result.messageId)
                  closeMobileSider()
                  setQuery('')
                }}
              >
                <span className={styles.resultTop}>
                  <span className={styles.roleTag}>
                    {t(
                      result.role === 'user'
                        ? 'historySearchRoleUser'
                        : 'historySearchRoleAssistant'
                    )}
                  </span>
                  <span className={styles.resultTitle}>
                    {result.sessionTitle || t('untitledChat')}
                  </span>
                </span>
                <span className={styles.snippet}>
                  {result.snippet.leadingEllipsis ? '…' : ''}
                  {result.snippet.before}
                  <mark>{result.snippet.match}</mark>
                  {result.snippet.after}
                  {result.snippet.trailingEllipsis ? '…' : ''}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
