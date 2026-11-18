import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import {
  ApkInstaller,
  isApkInstallerAvailable,
  isShaMismatchError,
  type ApkDownloadProgress,
  type ApkDownloadResult,
} from '../../services/apkInstaller.js'
import { githubFileUrls } from '../../services/githubProxy.js'
import {
  checkForUpdate,
  closeUpdateDialog,
  dismissUpdate,
  useUpdateStore,
  type AvailableRelease,
} from '../../services/update.js'
import styles from './UpdateDialog.module.css'

/**
 * 启动时静默检查更新（失败永不弹窗），有更新且未被忽略时弹出提示。
 * 挂载在 App 末尾，弹窗的 portal 顺序在设置弹窗之后，层叠时位于上层。
 */
export const UpdatePromptHost = () => {
  const dialogOpen = useUpdateStore((state) => state.dialogOpen)
  const release = useUpdateStore((state) => state.latestRelease)
  useEffect(() => {
    void checkForUpdate(false)
  }, [])
  if (!dialogOpen || !release) {
    return null
  }
  return <UpdateDialog key={release.tag} release={release} />
}

type Phase = 'prompt' | 'downloading' | 'permission' | 'installing' | 'error'
type ErrorKind = 'download' | 'hash' | 'install'

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const UpdateDialog = ({ release }: { release: AvailableRelease }) => {
  const t = useTranslate()
  const [phase, setPhase] = useState<Phase>('prompt')
  const [progress, setProgress] = useState<ApkDownloadProgress | null>(null)
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)
  const [installerAvailable, setInstallerAvailable] = useState<boolean | null>(null)
  const [settingsOpenFailed, setSettingsOpenFailed] = useState(false)
  const [fellBack, setFellBack] = useState(false)
  // Refs mirror phase/path for the resume listener (mounted once, needs latest values).
  const phaseRef = useRef<Phase>('prompt')
  const downloadedPathRef = useRef<string | null>(null)
  // At most one automatic settings jump per explicit install attempt; resume never jumps.
  const autoJumpDoneRef = useRef(false)
  // Guards concurrent install attempts (retry tap racing the resume check).
  const installInFlightRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void isApkInstallerAvailable().then((available) => {
      if (!cancelled) {
        setInstallerAvailable(available)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    downloadedPathRef.current = downloadedPath
  }, [downloadedPath])

  // Returning from system settings: if the permission is now granted, install
  // automatically; if still blocked, stay on the permission screen for a manual
  // retry. This path never opens settings itself, so it cannot loop.
  // No @capacitor/app dependency: visibilitychange + focus cover the WebView
  // being backgrounded by the settings activity.
  useEffect(() => {
    const checkOnReturn = async () => {
      const path = downloadedPathRef.current
      if (phaseRef.current !== 'permission' || installInFlightRef.current || !path) {
        return
      }
      installInFlightRef.current = true
      try {
        const { canInstall } = await ApkInstaller.canInstall()
        if (!canInstall) {
          return
        }
        setPhase('installing')
        await ApkInstaller.installApk({ path })
      } catch {
        setErrorKind('install')
        setPhase('error')
      } finally {
        installInFlightRef.current = false
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkOnReturn()
      }
    }
    const onFocus = () => {
      void checkOnReturn()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const openInBrowser = () => {
    window.open(release.htmlUrl, '_blank', 'noopener,noreferrer')
  }

  const installDownloaded = async (path: string, autoJump: boolean) => {
    if (installInFlightRef.current) {
      return
    }
    installInFlightRef.current = true
    try {
      const { canInstall } = await ApkInstaller.canInstall()
      if (!canInstall) {
        setSettingsOpenFailed(false)
        setPhase('permission')
        if (autoJump && !autoJumpDoneRef.current) {
          autoJumpDoneRef.current = true
          showToast({ key: 'updateJumpingToSettings' })
          try {
            await ApkInstaller.openUnknownSourcesSettings()
          } catch {
            setSettingsOpenFailed(true)
          }
        }
        return
      }
      setPhase('installing')
      await ApkInstaller.installApk({ path })
    } catch {
      setErrorKind('install')
      setPhase('error')
    } finally {
      installInFlightRef.current = false
    }
  }

  const startDownload = async () => {
    setPhase('downloading')
    setProgress(null)
    setErrorKind(null)
    setSettingsOpenFailed(false)
    setFellBack(false)
    autoJumpDoneRef.current = false
    const handle = await ApkInstaller.addListener('downloadProgress', (update) => {
      setProgress(update)
    })
    try {
      // Attempt order: proxied URL first, then the direct URL exactly once.
      // A SHA256 mismatch on the proxied file is treated like any other
      // download failure: the plugin deletes the bad file, the direct URL is
      // tried once with the same SHA check, and nothing mismatched is ever
      // installed. Direct mode yields a single URL, so there is no retry.
      const urls = githubFileUrls(release.apkUrl)
      const downloadOnce = (url: string) =>
        ApkInstaller.downloadApk({
          url,
          ...(release.sha256 ? { expectedSha256: release.sha256 } : {}),
        })
      let result: ApkDownloadResult | null = null
      let lastError: unknown = null
      for (const [index, url] of urls.entries()) {
        try {
          result = await downloadOnce(url)
          break
        } catch (error) {
          lastError = error
          if (index < urls.length - 1) {
            setFellBack(true)
            setProgress(null)
          }
        }
      }
      if (!result) {
        throw lastError
      }
      setDownloadedPath(result.path)
      await installDownloaded(result.path, true)
    } catch (error) {
      setErrorKind(isShaMismatchError(error) ? 'hash' : 'download')
      setPhase('error')
    } finally {
      await handle.remove()
    }
  }

  const retry = () => {
    if (errorKind === 'install' && downloadedPath) {
      autoJumpDoneRef.current = false
      void installDownloaded(downloadedPath, true)
    } else {
      void startDownload()
    }
  }

  const title =
    phase === 'permission' ? t('updateUnknownSourcesTitle') : t('updateAvailableTitle')

  return (
    <Modal
      title={title}
      onClose={() => {
        // 下载中不允许关闭（插件无取消接口）；其他阶段关闭只关弹窗，不记为“以后再说”。
        if (phase !== 'downloading') {
          closeUpdateDialog()
        }
      }}
      footer={
        phase === 'prompt' ? (
          <>
            <Button variant="outlined" size="m" onClick={() => dismissUpdate(release.tag)}>
              {t('updateLater')}
            </Button>
            {installerAvailable === false ? (
              <Button variant="primary" size="m" onClick={openInBrowser}>
                {t('updateOpenInBrowser')}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="m"
                disabled={installerAvailable === null}
                onClick={() => void startDownload()}
              >
                {t('updateNow')}
              </Button>
            )}
          </>
        ) : phase === 'permission' ? (
          <div className={styles.footerWrap}>
            <Button variant="outlined" size="m" onClick={openInBrowser}>
              {t('updateOpenInBrowser')}
            </Button>
            <Button
              variant="primary"
              size="m"
              disabled={!downloadedPath}
              onClick={() => {
                if (downloadedPath) {
                  // Explicit retry: a fresh attempt may jump to settings once more.
                  autoJumpDoneRef.current = false
                  void installDownloaded(downloadedPath, true)
                }
              }}
            >
              {t('updateInstall')}
            </Button>
          </div>
        ) : phase === 'installing' ? (
          <Button variant="primary" size="m" onClick={closeUpdateDialog}>
            {t('close')}
          </Button>
        ) : phase === 'error' ? (
          <>
            <Button variant="outlined" size="m" onClick={openInBrowser}>
              {t('updateOpenInBrowser')}
            </Button>
            <Button variant="primary" size="m" onClick={retry}>
              {t('retry')}
            </Button>
          </>
        ) : undefined
      }
    >
      {phase === 'prompt' ? (
        <div className={styles.body}>
          <div>{t('updateAvailableBody', { version: release.tag })}</div>
          <div className={styles.apkName}>{release.apkName}</div>
        </div>
      ) : phase === 'downloading' ? (
        <div className={styles.body}>
          <div>{t(fellBack ? 'updateRetryingDirect' : 'updateDownloading')}</div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              progress && progress.totalBytes > 0
                ? Math.min(
                    100,
                    Math.max(0, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100))
                  )
                : undefined
            }
          >
            <div
              className={
                progress && progress.totalBytes > 0
                  ? styles.progressFill
                  : `${styles.progressFill} ${styles.progressFillUnknown}`
              }
              style={{
                // Unknown total: 40%-wide sliding bar (see progressFillUnknown), never full.
                width:
                  progress && progress.totalBytes > 0
                    ? `${Math.min(100, Math.max(0, (progress.downloadedBytes / progress.totalBytes) * 100))}%`
                    : '40%',
              }}
            />
          </div>
          <div className={styles.bytes}>
            {progress && progress.totalBytes > 0
              ? `${Math.min(100, Math.max(0, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100)))}% · ${t('updateBytesDownloaded', { downloaded: formatBytes(progress.downloadedBytes), total: formatBytes(progress.totalBytes) })}`
              : t('updateDownloadedBytes', {
                  downloaded: formatBytes(progress?.downloadedBytes ?? 0),
                })}
          </div>
        </div>
      ) : phase === 'permission' ? (
        <div className={styles.body}>
          {t(settingsOpenFailed ? 'updateSettingsOpenFailed' : 'updateUnknownSourcesBody')}
        </div>
      ) : phase === 'installing' ? (
        <div className={styles.body}>{t('updateInstalling')}</div>
      ) : (
        <div className={styles.body}>
          {t(
            errorKind === 'hash'
              ? 'updateHashMismatch'
              : errorKind === 'install'
                ? 'updateInstallFailed'
                : 'updateFailed'
          )}
        </div>
      )}
    </Modal>
  )
}
