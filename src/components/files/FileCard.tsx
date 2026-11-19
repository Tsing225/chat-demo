import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { formatSize, getExtension } from '../../services/attachments.js'
import { IconCloseFill14, IconRefreshOutline16 } from '../base/icons.js'
import { FileIcon } from './FileIcon.js'
import { ImageViewer } from './ImageViewer.js'
import styles from './FileCard.module.css'

/**
 * 文档文件卡片：图标 + 文件名 + 「扩展名 大小」或状态文案。
 * 输入框内失败时描边和说明标红；可重试时显示刷新图标，不可重试时常显红色删除按钮。
 * 消息里的不可重试文件保留普通边框和状态说明。
 * 图片文件（imageUrl）点卡片在应用内查看原图，不再新窗口打开 blob: 地址；
 * 其余文件仍走 onOpen（新窗口打开）。
 */
export const FileCard = ({
  name,
  size,
  status = 'done',
  error,
  onRetry,
  onRemove,
  onOpen,
  imageUrl,
}: {
  name: string
  size: number
  status?: 'uploading' | 'done' | 'error'
  error?: string
  onRetry?: () => void
  onRemove?: () => void
  onOpen?: () => void
  /** 图片原件地址：提供且状态为 done 时，点卡片在应用内查看图片 */
  imageUrl?: string
}) => {
  const t = useTranslate()
  const ext = getExtension(name)
  let icon: ReactNode = <FileIcon ext={ext} />
  let description = [ext, formatSize(size)].filter(Boolean).join(' ')
  if (status === 'uploading') {
    icon = <span className={styles.spinner} />
    description = t('uploadFileStatusUploading')
  } else if (status === 'error') {
    // 不可重试（过大、格式不支持）时保留文件图标并显示原因
    if (onRetry) {
      icon = <IconRefreshOutline16 />
    }
    description = error ?? t('uploadFileStatusFailed')
  }
  const [viewerOpen, setViewerOpen] = useState(false)
  const onClick =
    status === 'error'
      ? onRetry
      : status === 'done'
        ? imageUrl
          ? () => setViewerOpen(true)
          : onOpen
        : undefined
  return (
    <>
      <div
        className={clsx(
          styles.card,
          onRemove && styles.editable,
          status === 'error' && (onRemove || onRetry) && styles.failed,
          onClick && styles.clickable
        )}
        title={
          status === 'error'
            ? onRetry
              ? t('uploadRetry', { message: description })
              : description
            : name
        }
        onClick={onClick}
      >
        <div className={clsx(styles.icon, status === 'error' && onRetry && styles.retry)}>
          {icon}
        </div>
        <div className={styles.content}>
          <div className={styles.caption}>{name}</div>
          <div className={styles.subCaption}>{description}</div>
        </div>
        {onRemove ? (
          <button
            type="button"
            className={clsx(styles.remove, status === 'error' && !onRetry && styles.invalidRemove)}
            aria-label={t('delete')}
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
          >
            <IconCloseFill14 />
          </button>
        ) : null}
      </div>
      {viewerOpen && imageUrl ? (
        <ImageViewer src={imageUrl} alt={name} onClose={() => setViewerOpen(false)} />
      ) : null}
    </>
  )
}
