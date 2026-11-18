import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import {
  ApkInstaller,
  isApkInstallerAvailable,
  isShaMismatchError,
  type ApkDownloadProgress,
} from '../../services/apkInstaller.js'
import { withGithubProxy } from '../../services/githubProxy.js'
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

  const openInBrowser = () => {
    window.open(release.htmlUrl, '_blank', 'noopener,noreferrer')
  }

  const installDownloaded = async (path: string) => {
    try {
      const { canInstall } = await ApkInstaller.canInstall()
      if (!canInstall) {
        setPhase('permission')
        return
      }
      setPhase('installing')
      await ApkInstaller.installApk({ path })
    } catch {
      setErrorKind('install')
      setPhase('error')
    }
  }

  const startDownload = async () => {
    setPhase('downloading')
    setProgress(null)
    setErrorKind(null)
    const handle = await ApkInstaller.addListener('downloadProgress', (update) => {
      setProgress(update)
    })
    try {
      const result = await ApkInstaller.downloadApk({
        url: withGithubProxy(release.apkUrl),
        ...(release.sha256 ? { expectedSha256: release.sha256 } : {}),
      })
      setDownloadedPath(result.path)
      await installDownloaded(result.path)
    } catch (error) {
      setErrorKind(isShaMismatchError(error) ? 'hash' : 'download')
      setPhase('error')
    } finally {
      await handle.remove()
    }
  }

  const openUnknownSources = async () => {
    try {
      await ApkInstaller.openUnknownSourcesSettings()
    } catch {
      // 打开系统设置失败时留在当前界面，用户可改走浏览器兜底。
    }
  }

  const retry = () => {
    if (errorKind === 'install' && downloadedPath) {
      void installDownloaded(downloadedPath)
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
              variant="outlined"
              size="m"
              disabled={!downloadedPath}
              onClick={() => {
                if (downloadedPath) {
                  void installDownloaded(downloadedPath)
                }
              }}
            >
              {t('updateInstall')}
            </Button>
            <Button variant="primary" size="m" onClick={() => void openUnknownSources()}>
              {t('updateOpenSettings')}
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
          <div>{t('updateDownloading')}</div>
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
                width:
                  progress && progress.totalBytes > 0
                    ? `${Math.min(100, Math.max(0, (progress.downloadedBytes / progress.totalBytes) * 100))}%`
                    : '100%',
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
        <div className={styles.body}>{t('updateUnknownSourcesBody')}</div>
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
