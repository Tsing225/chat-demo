import { Capacitor, registerPlugin, type Plugin } from '@capacitor/core'
import { useSettings, type FontSizeLevel } from './settings.js'

/** 手动档位对应的缩放比例：小 87.5% / 标准 100% / 大 112.5% / 特大 125%。 */
export const FONT_SIZE_SCALES: Record<FontSizeLevel, number> = {
  small: 0.875,
  standard: 1,
  large: 1.125,
  xlarge: 1.25,
}

/** 滑块档位顺序（从左到右）。 */
export const FONT_SIZE_LEVELS: FontSizeLevel[] = ['small', 'standard', 'large', 'xlarge']

/** 跟随系统时系统字号的钳制范围，避免极端系统设置撑坏布局。 */
const MIN_SYSTEM_SCALE = 0.85
const MAX_SYSTEM_SCALE = 1.3

export const clampFontScale = (scale: number): number =>
  Math.min(MAX_SYSTEM_SCALE, Math.max(MIN_SYSTEM_SCALE, scale))

/**
 * 系统字号读取插件（Java 实现，见 android/app/src/main/java/.../FontScalePlugin.java，
 * MainActivity 里手动注册）。只暴露一个方法，返回 Android 系统字体缩放
 * Settings.System.FONT_SCALE；只读，不需要任何权限。
 * Web / PWA 上不存在，调用方必须用 getSystemFontScale 探测并容忍 null。
 */
export interface FontScalePlugin extends Plugin {
  getFontScale(): Promise<{ scale: number }>
}

export const FontScale = registerPlugin<FontScalePlugin>('FontScale')

/**
 * 读取系统字体缩放；非原生平台、插件缺失或返回值异常时返回 null，
 * 调用方回落到手动档位，绝不抛错。
 */
export const getSystemFontScale = async (): Promise<number | null> => {
  if (!Capacitor.isNativePlatform()) {
    return null
  }
  try {
    const { scale } = await FontScale.getFontScale()
    return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : null
  } catch {
    return null
  }
}

/** 生效方式：--font-scale 变量乘进主题字号变量与消息 / 侧边栏 / 输入框字号（见 theme.css）。 */
const applyFontScale = (scale: number) => {
  document.documentElement.style.setProperty('--font-scale', String(scale))
  // 部分旧版 Android WebView 不会仅因变量变化就重算经自定义属性传入 font 简写的字号，
  // 要等下一次布局才重绘；同步读一次布局强制重算，改完立即可见，新版引擎上无影响。
  void document.documentElement.offsetHeight
}

/** 解析当前应生效的缩放：跟随系统时读原生值（失败则回落手动档位），否则直接用手动档位。 */
let resolveToken = 0

const syncFontScale = () => {
  const token = ++resolveToken
  const { fontSize, followSystemFontSize } = useSettings.getState()
  const manualScale = FONT_SIZE_SCALES[fontSize]
  if (!followSystemFontSize) {
    applyFontScale(manualScale)
    return
  }
  // 先用手动档位立即生效，避免原生读取的异步间隙里字号跳变；读到系统值后再覆盖。
  applyFontScale(manualScale)
  void getSystemFontScale().then((systemScale) => {
    if (token !== resolveToken) {
      return
    }
    applyFontScale(systemScale === null ? manualScale : clampFontScale(systemScale))
  })
}

/** 启动时同步应用一次，之后随字体设置变化更新；与 setupTheme 同模式，在 main.tsx 调用。 */
export const setupFontScale = () => {
  syncFontScale()
  useSettings.subscribe(syncFontScale)
}
