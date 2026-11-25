'use strict'
/**
 * Preload bridge: exposes the smallest possible desktop API to the renderer.
 * No Node access is leaked; the renderer only learns it runs on desktop and
 * can ask the main process to open an http(s) URL in the system browser.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
})
