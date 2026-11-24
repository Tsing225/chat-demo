import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconArchiveOutline16,
  IconCheckOutline16,
  IconDownloadOutline16,
  IconLinkOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import {
  exportSessionDocx,
  exportSessionHtml,
  exportSessionMarkdown,
  shareSessionMarkdown,
} from '../../services/chat/exportSession.js'
import { renameSession, selectSession, setSessionFlags } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
  /** 多选模式：行首显示复选框，点击行切换选中，菜单隐藏 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  /** 导出单个会话为 Markdown 并复制到剪贴板，结果用 Toast 告知。 */
  const handleExport = async () => {
    const result = await exportSessionMarkdown(session.id)
    if (result === 'copied') {
      showToast({ key: 'sessionExportCopied' })
    } else if (result === 'empty') {
      showToast({ key: 'sessionExportEmpty' })
    } else {
      showToast({ key: 'sessionExportCopyFailed', type: 'error' })
    }
  }

  /** 系统分享：把 Markdown 文本发到其他应用；取消分享不弹错。 */
  const handleShare = async () => {
    const result = await shareSessionMarkdown(session.id)
    if (result === 'shared') {
      showToast({ key: 'sessionExportShared' })
    } else if (result === 'empty') {
      showToast({ key: 'sessionExportEmpty' })
    } else if (result !== 'cancelled') {
      showToast({ key: 'sessionExportShareFailed', type: 'error' })
    }
  }

  /** Word 文档存到本机 Documents 目录（网页端为下载），结果用 Toast 告知保存位置。 */
  const handleExportDocx = async () => {
    const { result, path } = await exportSessionDocx(session.id)
    if (result === 'saved') {
      showToast({ key: 'sessionExportDocxSaved', params: { path: path ?? '' } })
    } else if (result === 'downloaded') {
      showToast({ key: 'sessionExportDocxDownloaded' })
    } else if (result === 'empty') {
      showToast({ key: 'sessionExportEmpty' })
    } else {
      showToast({ key: 'sessionExportDocxFailed', type: 'error' })
    }
  }

  /** HTML 文件写到缓存后用系统分享发给其他应用（网页端为下载）。 */
  const handleExportHtml = async () => {
    const { result } = await exportSessionHtml(session.id)
    if (result === 'shared') {
      showToast({ key: 'sessionExportShared' })
    } else if (result === 'downloaded') {
      showToast({ key: 'sessionExportHtmlDownloaded' })
    } else if (result === 'empty') {
      showToast({ key: 'sessionExportEmpty' })
    } else if (result !== 'cancelled') {
      showToast({ key: 'sessionExportHtmlFailed', type: 'error' })
    }
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      onClick={() => {
        if (selectable) {
          onToggleSelect?.()
          return
        }
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      {selectable ? (
        <span
          className={clsx(styles.checkbox, selected && styles.checkboxChecked)}
          role="checkbox"
          aria-checked={selected}
        >
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      {session.pinned ? (
        <span className={styles.pinIcon}>
          <IconPinOutline16 />
        </span>
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      {selectable ? null : (
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu
            options={[
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              {
                key: 'pin',
                label: session.pinned
                  ? t('sessionItemMenuUnpinOption')
                  : t('sessionItemMenuPinOption'),
                icon: <IconPinOutline16 />,
                onSelect: () => setSessionFlags(session.id, { pinned: !session.pinned }),
              },
              {
                key: 'archive',
                label: session.archived
                  ? t('sessionItemMenuUnarchiveOption')
                  : t('sessionItemMenuArchiveOption'),
                icon: <IconArchiveOutline16 />,
                onSelect: () => setSessionFlags(session.id, { archived: !session.archived }),
              },
              {
                key: 'export',
                label: t('sessionItemMenuExportOption'),
                icon: <IconDownloadOutline16 />,
                onSelect: () => void handleExport(),
              },
              {
                key: 'share',
                label: t('sessionExportShareOption'),
                icon: <IconLinkOutline16 />,
                onSelect: () => void handleShare(),
              },
              {
                key: 'exportDocx',
                label: t('sessionExportDocxOption'),
                icon: <IconDownloadOutline16 />,
                onSelect: () => void handleExportDocx(),
              },
              {
                key: 'exportHtml',
                label: t('sessionExportHtmlOption'),
                icon: <IconDownloadOutline16 />,
                onSelect: () => void handleExportHtml(),
              },
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
            )}
          </Menu>
        </div>
      )}
    </div>
  )
})
