import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconArchiveOutline16,
  IconCheckOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
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
