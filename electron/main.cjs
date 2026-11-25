'use strict'
/**
 * Windows desktop shell for deepseek for chat (unofficial, non-DeepSeek build).
 *
 * Minimal Electron main process: it loads the production dist/ — the same
 * static React SPA the Android Capacitor build uses — straight from disk.
 * No API key is bundled, there is no billing proxy and no chat content is
 * collected: the renderer talks to https://api.deepseek.com directly, exactly
 * like the web / Android builds. Conversations live in IndexedDB /
 * localStorage inside Electron's userData dir and are never moved or wiped.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')

const isHttpUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 540,
    title: 'deepseek for chat',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Links (target=_blank) and any in-page navigation to a web URL open in
  // the user's default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isHttpUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('desktop:open-external', (_event, url) => {
    if (typeof url === 'string' && isHttpUrl(url)) {
      return shell.openExternal(url)
    }
    return Promise.reject(new Error('Refused to open non-http(s) URL'))
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
