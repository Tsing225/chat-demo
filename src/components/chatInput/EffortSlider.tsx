import { useRef } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { ReasoningEffort } from '../../services/api/types.js'
import { setReasoningEffort, useSettings } from '../../services/settings.js'
import styles from './EffortSlider.module.css'

/**
 * 推理强度档位（分段选择，从左到右）：直接对应 Messages API 的 output_config.effort。
 * Low -> low，High -> high，Max -> max。
 */
export const EFFORT_LEVELS: ReasoningEffort[] = ['low', 'high', 'max']

/** 档位名使用用户指定的英文名，双语界面一致。 */
const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: 'Low',
  high: 'High',
  max: 'Max',
}

const HINT_KEYS: Record<ReasoningEffort, TranslationKey> = {
  low: 'effortHintLow',
  high: 'effortHintHigh',
  max: 'effortHintMax',
}

/**
 * 推理强度分段选择（Codex 桌面端风格）：一行三个药丸按钮，点选切换，不拖动。
 * 深度解析关闭时禁用（强度只在思考模式生效）。
 * 颜色随档位从蓝变紫，Max 档带轻量光晕（纯 CSS，无 WebGL）。
 */
export const EffortSlider = () => {
  const t = useTranslate()
  const thinking = useSettings((state) => state.thinking)
  const effort = useSettings((state) => state.reasoningEffort)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const disabled = !thinking
  const selectedIndex = EFFORT_LEVELS.indexOf(effort)

  const select = (level: ReasoningEffort) => {
    setReasoningEffort(level)
  }

  const selectIndex = (index: number) => {
    const clamped = Math.min(EFFORT_LEVELS.length - 1, Math.max(0, index))
    const level = EFFORT_LEVELS[clamped]
    setReasoningEffort(level)
    buttonRefs.current[clamped]?.focus()
  }

  return (
    <div className={styles.effort} data-level={selectedIndex} data-disabled={disabled}>
      <div className={styles.header}>
        <span className={styles.title}>{t('effortLabel')}</span>
        <span className={styles.status}>
          {disabled
            ? t('effortDisabledHint')
            : `${EFFORT_LABELS[effort]} · ${t(HINT_KEYS[effort])}`}
        </span>
      </div>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label={t('effortLabel')}
        aria-disabled={disabled}
        onKeyDown={(event) => {
          if (disabled) {
            return
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault()
            selectIndex(selectedIndex + 1)
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault()
            selectIndex(selectedIndex - 1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            selectIndex(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            selectIndex(EFFORT_LEVELS.length - 1)
          }
        }}
      >
        {EFFORT_LEVELS.map((level, index) => (
          <button
            key={level}
            ref={(element) => {
              buttonRefs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={effort === level}
            disabled={disabled}
            className={
              effort === level
                ? `${styles.segment} ${styles.segmentSelected}`
                : styles.segment
            }
            onClick={() => select(level)}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </div>
    </div>
  )
}
