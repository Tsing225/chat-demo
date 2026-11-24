import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import {
  ShareImportError,
  importShareLink,
  type ShareImportProgress,
} from '../../services/chat/history/shareImport.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setAutoCollapseInput,
  setFollowSystemFontSize,
  setFontSize,
  setLocale,
  setLocation,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type FontSizeLevel,
  type ThemePreference,
} from '../../services/settings.js'
import { FONT_SIZE_LEVELS } from '../../services/fontScale.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { AboutSection } from './AboutSection.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）、「数据管理」（API Key、导入、导出、删除）与「关于」（版本、更新、价格、致谢与联系）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  {
    value: 'about',
    label: 'settingDialogAsideAboutOptionLabel',
    icon: <IconLinkOutline16 />,
  },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <FontSizeSetting />
              <AutoCollapseInputSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
            </>
          ) : section === 'data' ? (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <ShareImport disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          ) : (
            <AboutSection />
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

const FONT_SIZE_LABEL_KEYS: Record<FontSizeLevel, TranslationKey> = {
  small: 'settingsFontSizeSmall',
  standard: 'settingsFontSizeStandard',
  large: 'settingsFontSizeLarge',
  xlarge: 'settingsFontSizeXLarge',
}

/** 字体大小：跟随系统开关 + 四档滑块；跟随系统开启时滑块禁用，改动立即生效并持久化，滑块下方预览行随字号实时变化。 */
const FontSizeSetting = () => {
  const t = useTranslate()
  const followSystemFontSize = useSettings((state) => state.followSystemFontSize)
  return (
    <div className={styles.fontSize}>
      <div className={styles.fontSizeHeader}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsFontSize')}</div>
          <div className={styles.description}>{t('settingsFontSizeFollowSystemDescription')}</div>
        </div>
        <div className={styles.fontSizeToggle}>
          <span>{t('settingsFontSizeFollowSystem')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={followSystemFontSize}
            aria-label={t('settingsFontSizeFollowSystem')}
            className={clsx(styles.fontSwitch, followSystemFontSize && styles.fontSwitchOn)}
            onClick={() => setFollowSystemFontSize(!followSystemFontSize)}
          >
            <span className={styles.fontSwitchKnob} />
          </button>
        </div>
      </div>
      <FontSizeSlider disabled={followSystemFontSize} />
      <div className={styles.fontPreview}>{t('settingsFontSizePreview')}</div>
    </div>
  )
}

/** 翻看对话时自动折叠输入框：默认开启，开关立即生效并持久化（localStorage）。 */
const AutoCollapseInputSetting = () => {
  const t = useTranslate()
  const autoCollapseInput = useSettings((state) => state.autoCollapseInput)
  return (
    <SettingCell
      label={t('settingsAutoCollapseInput')}
      description={t('settingsAutoCollapseInputDescription')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={autoCollapseInput}
          aria-label={t('settingsAutoCollapseInput')}
          className={clsx(styles.fontSwitch, autoCollapseInput && styles.fontSwitchOn)}
          onClick={() => setAutoCollapseInput(!autoCollapseInput)}
        >
          <span className={styles.fontSwitchKnob} />
        </button>
      }
    />
  )
}

const clampFontIndex = (value: number): number => Math.min(3, Math.max(0, value))

/**
 * 字体大小滑块：与推理强度滑块同模式，拖动时旋钮跟随手指，松手后吸附到最近档位；
 * 点按轨道任意位置也会选中最近档位，方向键可逐档调节。禁用时不响应操作。
 */
const FontSizeSlider = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const fontSize = useSettings((state) => state.fontSize)
  const trackRef = useRef<HTMLDivElement>(null)
  // 拖动中的连续位置（0-3）；null 表示未拖动，显示已提交的档位。
  const [dragValue, setDragValue] = useState<number | null>(null)

  const committedIndex = FONT_SIZE_LEVELS.indexOf(fontSize)
  const displayValue = dragValue ?? committedIndex
  const displayIndex = Math.round(clampFontIndex(displayValue))
  const displayLevel = FONT_SIZE_LEVELS[displayIndex]

  const valueFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) {
      return committedIndex
    }
    return clampFontIndex(((clientX - rect.left) / rect.width) * 3)
  }

  const commit = (value: number) => {
    setFontSize(FONT_SIZE_LEVELS[Math.round(clampFontIndex(value))])
  }

  return (
    <div className={styles.fontSlider} data-disabled={disabled}>
      <div
        ref={trackRef}
        className={styles.fontTrack}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t('settingsFontSize')}
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={displayIndex}
        aria-valuetext={t(FONT_SIZE_LABEL_KEYS[displayLevel])}
        aria-disabled={disabled}
        onPointerDown={(event) => {
          if (disabled) {
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragValue(valueFromClientX(event.clientX))
        }}
        onPointerMove={(event) => {
          if (disabled || dragValue === null) {
            return
          }
          setDragValue(valueFromClientX(event.clientX))
        }}
        onPointerUp={() => {
          if (disabled || dragValue === null) {
            return
          }
          commit(dragValue)
          setDragValue(null)
        }}
        onPointerCancel={() => {
          if (dragValue !== null) {
            setDragValue(null)
          }
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            commit(committedIndex + 1)
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            commit(committedIndex - 1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            commit(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            commit(3)
          }
        }}
      >
        <div className={styles.fontRail} />
        <div className={styles.fontFill} style={{ width: `${(displayValue / 3) * 100}%` }} />
        {FONT_SIZE_LEVELS.map((level, index) => (
          <span
            key={level}
            aria-hidden
            className={styles.fontTick}
            style={{ left: `${(index / 3) * 100}%` }}
          />
        ))}
        <div className={styles.fontKnob} style={{ left: `${(displayValue / 3) * 100}%` }} />
      </div>
      <div className={styles.fontTickLabels} aria-hidden>
        {FONT_SIZE_LEVELS.map((level, index) => (
          <span
            key={level}
            className={index === displayIndex ? styles.fontTickLabelActive : undefined}
          >
            {t(FONT_SIZE_LABEL_KEYS[level])}
          </span>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
/** 分享链接导入的进度文案。 */
const shareImportPhaseKey = (phase: ShareImportProgress['phase']): TranslationKey => {
  switch (phase) {
    case 'fetch':
      return 'shareImportFetching'
    case 'convert':
      return 'shareImportConverting'
    case 'files':
      return 'shareImportDownloadingFiles'
    case 'save':
      return 'shareImportSaving'
  }
}

/** 从 DeepSeek 分享链接导入单个对话：只新增，不覆盖已有对话。 */
const useShareImport = () => {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const submit = async () => {
    if (!input.trim() || importing.current) {
      return
    }
    importing.current = true
    setBusy(true)
    setStatus(null)
    try {
      const result = await importShareLink(input, (progress) => {
        setStatus({
          key: shareImportPhaseKey(progress.phase),
          params: { done: progress.done, total: progress.total },
        })
      })
      setInput('')
      setStatus({
        key:
          result.failedFiles > 0 || result.droppedMessages > 0
            ? 'shareImportDonePartial'
            : 'shareImportDone',
        params: {
          count: result.turns,
          failed: result.failedFiles,
          dropped: result.droppedMessages,
        },
      })
    } catch (error) {
      if (error instanceof ShareImportError) {
        setStatus({ key: error.key, error: true })
      } else {
        setStatus({
          key: 'shareImportFailed',
          params: { message: error instanceof Error ? error.message : String(error) },
          error: true,
        })
      }
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { input, setInput, busy, status, submit }
}

const ShareImport = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const shareImport = useShareImport()
  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('shareImport')}</div>
        <div className={styles.description}>{t('shareImportDescription')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            placeholder={t('shareImportPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={shareImport.input}
            disabled={disabled || shareImport.busy}
            onChange={(event) => shareImport.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void shareImport.submit()
              }
            }}
          />
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.confirm}
            disabled={disabled || shareImport.busy || !shareImport.input.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void shareImport.submit()}
          >
            {shareImport.busy ? t('shareImportImporting') : t('shareImportButton')}
          </button>
        </div>
        {shareImport.status ? (
          <div className={clsx(styles.description, shareImport.status.error && styles.error)}>
            {t(shareImport.status.key, shareImport.status.params)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
