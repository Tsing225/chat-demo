import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, removeSessions, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { GlobalSearch } from '../historySearch/GlobalSearch.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  /** 置顶会话单独成组，排在最上方，组内仍按 updatedAt 降序；已归档的会话只出现在底部已归档区。 */
  const pinned = useMemo(
    () => sessions.filter((session) => session.pinned && !session.archived),
    [sessions]
  )
  const archived = useMemo(() => sessions.filter((session) => session.archived), [sessions])
  const regular = useMemo(
    () => sessions.filter((session) => !session.pinned && !session.archived),
    [sessions]
  )
  const groups = useMemo(() => groupSessions(regular, now, t), [regular, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [multiSelecting, setMultiSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [confirmingMultiDelete, setConfirmingMultiDelete] = useState(false)
  const [multiDeletePending, setMultiDeletePending] = useState(false)
  /** 全选只作用于当前可见的行：已归档区收起时不选中其中会话。 */
  const visibleIds = useMemo(
    () =>
      [...pinned, ...regular, ...(archivedExpanded ? archived : [])].map(
        (session) => session.id
      ),
    [pinned, regular, archived, archivedExpanded]
  )

  const exitMultiSelect = () => {
    setMultiSelecting(false)
    setSelectedIds(new Set())
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (visibleIds.every((id) => next.has(id))) {
        visibleIds.forEach((id) => next.delete(id))
      } else {
        visibleIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const renderSession = (session: SessionSummary) => (
    <SessionItem
      key={session.id}
      session={session}
      active={session.id === activeId}
      onDelete={() => setDeleting(session)}
      selectable={multiSelecting}
      selected={selectedIds.has(session.id)}
      onToggleSelect={() => toggleSelect(session.id)}
    />
  )

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <GlobalSearch />
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      {sessions.length > 0 ? (
        <div className={styles.listToolbar}>
          {multiSelecting ? (
            <>
              <button type="button" className={styles.toolbarButton} onClick={exitMultiSelect}>
                {t('cancel')}
              </button>
              <span className={styles.toolbarCount}>
                {t('multiSelectSelected', { count: selectedIds.size })}
              </span>
              <button type="button" className={styles.toolbarButton} onClick={selectAllVisible}>
                {t('multiSelectAll')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.toolbarButton}
              onClick={() => {
                setSelectedIds(new Set())
                setMultiSelecting(true)
              }}
            >
              {t('multiSelect')}
            </button>
          )}
        </div>
      ) : null}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {pinned.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>{t('pinnedSectionTitle')}</div>
              {pinned.map(renderSession)}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map(renderSession)}
            </div>
          ))}
          {archived.length > 0 ? (
            <div className={styles.section}>
              <button
                type="button"
                className={styles.archivedHeader}
                aria-expanded={archivedExpanded}
                onClick={() => setArchivedExpanded((value) => !value)}
              >
                <span className={styles.archivedChevron}>
                  {archivedExpanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                </span>
                {t('archivedSectionTitle')}
                <span className={styles.archivedCount}>({archived.length})</span>
              </button>
              {archivedExpanded ? archived.map(renderSession) : null}
            </div>
          ) : null}
        </div>
      </div>
      {multiSelecting ? (
        <div className={styles.multiSelectBar}>
          <Button
            variant="danger"
            size="m"
            block
            disabled={selectedIds.size === 0 || multiDeletePending}
            onClick={() => setConfirmingMultiDelete(true)}
          >
            {t('multiSelectDeleteButton', { count: selectedIds.size })}
          </Button>
        </div>
      ) : null}
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {confirmingMultiDelete ? (
        <Modal
          title={t('deleteSessionsModalContentTitle', { count: selectedIds.size })}
          onClose={() => {
            if (!multiDeletePending) {
              setConfirmingMultiDelete(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={multiDeletePending}
                onClick={() => setConfirmingMultiDelete(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={multiDeletePending}
                onClick={async () => {
                  setMultiDeletePending(true)
                  try {
                    if (await removeSessions([...selectedIds])) {
                      setConfirmingMultiDelete(false)
                      exitMultiSelect()
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setMultiDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionsWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
