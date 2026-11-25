/**
 * Desktop (Electron) detection + helpers.
 *
 * The Windows shell exposes `window.electronAPI` from electron/preload.cjs.
 * On Android / web / PWA it does not exist, so everything here is a no-op
 * outside the desktop app. Desktop never offers APK downloads: see the
 * desktop branch in services/update.ts.
 */
declare global {
  interface ElectronApi {
    isDesktop: boolean
    openExternal: (url: string) => Promise<void>
  }

  interface Window {
    electronAPI?: ElectronApi
  }
}

export const getElectronApi = (): ElectronApi | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const api = window.electronAPI
  return api && api.isDesktop === true ? api : null
}

/** True only inside the Electron desktop shell. */
export const isDesktopApp = (): boolean => getElectronApi() !== null

/**
 * Open a URL in the system browser. On desktop this goes through Electron's
 * shell (no new app window is spawned); elsewhere it is a plain window.open
 * fallback.
 */
export const openExternalUrl = async (url: string): Promise<void> => {
  const api = getElectronApi()
  if (api) {
    await api.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
