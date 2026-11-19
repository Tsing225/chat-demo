import clsx from 'clsx'
import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  IconAppsOutline16,
  IconCameraOutline16,
  IconChevronDownOutline14,
  IconGlobeLanguageOutline14,
  IconImageOutline16,
  IconPaperclipOutline16,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, getFileExt, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { InputCollapseContext } from '../messages/scrollContext.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import {
  formatCostYuan,
  getContextRemainingPercent,
  getSessionCost,
  usePrices,
} from '../../services/pricing.js'
import { EffortSlider } from './EffortSlider.js'
import styles from './ChatInput.module.css'

/** Accepted image extensions (upload whitelist, see uploadExts.ts) for camera captures. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'svg', 'svgz', 'bmp', 'gif', 'webp', 'ico', 'xbm', 'dib', 'pjp', 'tif', 'pjpeg', 'avif', 'apng', 'tiff', 'jfif'])

/** 输入框上方的一行小字：上下文剩余百分比与本对话累计费用（均为约数）。新对话显示满格与 0.00。 */
const ContextBar = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const session = useChatStore((state) =>
    sessionId !== null && Object.hasOwn(state.sessionCache, sessionId)
      ? state.sessionCache[sessionId]
      : undefined
  )
  const table = usePrices((state) => state.table)
  const percent = getContextRemainingPercent(session, table)
  const cost = session ? getSessionCost(session, table) : 0
  return (
    <div className={styles.contextBar}>
      {t('contextRemaining', { percent, cost: formatCostYuan(cost) })}
    </div>
  )
}

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  // Camera captures can arrive with an extensionless name; validateFiles
  // rejects those, so normalize to a .jpg name before the shared path.
  const acceptPhoto = (file: File) => {
    const photo = IMAGE_EXTS.has(getFileExt(file.name))
      ? file
      : new File([file], 'photo-' + Date.now() + '.jpg', { type: 'image/jpeg' })
    acceptFiles([photo])
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 输入框折叠：手动折叠与自动折叠共用同一状态。草稿（文字与附件）存在
  // drafts store 中，与 textarea 是否挂载无关，所以折叠不会丢失草稿；
  // 附件上传任务同样在 useUploads store 中，折叠后继续上传。
  const autoCollapseInput = useSettings((state) => state.autoCollapseInput)
  const { isAtBottom } = useContext(InputCollapseContext)
  const [collapsed, setCollapsed] = useState(false)
  const voiceActive = voice.status !== 'idle'

  // 自动折叠只在“是否在底部”翻转时触发：上滑离开底部时折叠，回到
  // 底部时展开。手动点开后不再重复触发，直到下一次底部状态翻转。
  // 录音 / 转写中不自动折叠，否则录音控制会被藏起来无法停止；
  // 折叠按钮在录音 / 转写中同样禁用，录完或取消后才能手动折叠。
  useEffect(() => {
    if (!autoCollapseInput || voiceActive) {
      return
    }
    setCollapsed(!isAtBottom)
  }, [isAtBottom, autoCollapseInput, voiceActive])

  const expandInput = useCallback(() => {
    setCollapsed(false)
    // 手动点开是明确要输入：恢复焦点；自动展开（回到底部）不抢焦点、不弹键盘。
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))
  }, [])

  const collapseInput = useCallback(() => {
    textareaRef.current?.blur()
    setCollapsed(true)
  }, [])

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  // 折叠态：只剩一条细栏（草稿预览 + 展开箭头）。ContextBar、输入框、附件、
  // 工具栏与 EffortSlider 全部隐藏，但草稿仍在 store 中，展开后原样恢复。
  // 流式回答中折叠时保留停止按钮；拖拽遮罩是挂到 body 的 portal，折叠时仍可用。
  if (collapsed) {
    const preview = text.trim()
      ? text.trim()
      : attachments.length > 0
        ? t('chatInputCollapsedAttachments', { count: attachments.length })
        : t('chatInputPlaceholderChat')
    return (
      <div
        className={clsx(
          styles.wrapper,
          sessionId === null ? styles.home : styles.session,
          styles.collapsed
        )}
      >
        <div className={styles.collapsedBar}>
          <button
            type="button"
            className={styles.collapsedExpand}
            aria-label={t('chatInputExpand')}
            title={t('chatInputCollapsedHint')}
            onClick={expandInput}
          >
            <span
              className={clsx(
                styles.collapsedPreview,
                (text.trim() || attachments.length > 0) && styles.collapsedPreviewHasDraft
              )}
            >
              {preview}
            </span>
            <span className={styles.collapsedChevron} aria-hidden>
              <IconChevronDownOutline14 />
            </span>
          </button>
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : null}
        </div>
        {dragging ? <DragMask /> : null}
      </div>
    )
  }

  return (
    <>
      <ContextBar sessionId={sessionId} />
      <div
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
            placeholder={t('chatInputPlaceholderChat')}
            rows={2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          <div className={styles.mirror} aria-hidden>
            {`${text}\n`}
          </div>
        </div>
        <div className={styles.functionRow}>
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div className={styles.toggles}>
            <Tooltip content={t('deactivatedThinkTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, thinking && styles.selected)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                onClick={() => setThinking(!thinking)}
              >
                <IconThinkOutline14 />
                <span className={styles.toggleLabel}>{t('composerThinkLabel')}</span>
              </button>
            </Tooltip>
            <Tooltip content={t('deactivatedSearchTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('search')}
                aria-pressed={search}
                onClick={() => setSearch(!search)}
              >
                <IconGlobeLanguageOutline14 />
                <span className={styles.toggleLabel}>{t('composerSearchLabel')}</span>
              </button>
            </Tooltip>
          </div>
          <div className={styles.right}>
            <VoiceButton
              status={voice.status}
              disabled={!voice.available}
              seconds={voice.seconds}
              onClick={() => {
                if (
                  voice.status !== 'idle' ||
                  (!useChatStore.getState().importingHistory && ensureApiKey())
                ) {
                  void voice.toggle()
                }
              }}
            />
            <Menu
              options={[
                {
                  key: 'takePhoto',
                  label: t('takePhoto'),
                  icon: <IconCameraOutline16 />,
                  onSelect: () => {
                    if (ensureApiKey()) {
                      cameraInputRef.current?.click()
                    }
                  },
                },
                {
                  key: 'photo',
                  label: t('attachPhoto'),
                  icon: <IconImageOutline16 />,
                  onSelect: () => {
                    if (ensureApiKey()) {
                      photoInputRef.current?.click()
                    }
                  },
                },
                {
                  key: 'file',
                  label: t('uploadFile'),
                  icon: <IconPaperclipOutline16 />,
                  onSelect: () => {
                    if (ensureApiKey()) {
                      fileInputRef.current?.click()
                    }
                  },
                },
                {
                  // 应用内暂无插件体系：先占位展示，不可点，不收集任何内容。
                  key: 'plugin',
                  label: t('attachPlugin'),
                  icon: <IconAppsOutline16 />,
                  hint: t('attachPluginEmpty'),
                  disabled: true,
                },
              ]}
            >
              {({ open, toggle }) => (
                <IconButton
                  size="m"
                  tone="primary"
                  icon={<IconPlusOutline16 />}
                  tooltip={t('attachMenu')}
                  className={clsx(styles.plusButton, open && styles.plusButtonOpen)}
                  disabled={importingHistory}
                  onClick={toggle}
                />
              )}
            </Menu>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(event) => {
                acceptFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
            <input
              ref={(element) => {
                cameraInputRef.current = element
                element?.setAttribute('capture', 'environment')
              }}
              type="file"
              hidden
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  acceptPhoto(file)
                }
                event.target.value = ''
              }}
            />
            <input
              ref={photoInputRef}
              type="file"
              multiple
              hidden
              accept="image/*"
              onChange={(event) => {
                acceptFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <IconStopFill16 />
              </button>
            ) : (
              <button
                type="button"
                className={clsx(styles.sendButton, !canSend && styles.disabled)}
                aria-label={t('send')}
                aria-disabled={!canSend}
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            )}
            <button
              type="button"
              className={styles.collapseButton}
              aria-label={t('chatInputCollapse')}
              aria-expanded={!collapsed}
              title={t('chatInputCollapse')}
              disabled={voiceActive}
              onClick={collapseInput}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        </div>
        {dragging ? <DragMask /> : null}
        <EffortSlider />
      </div>
    </>
  )
}
