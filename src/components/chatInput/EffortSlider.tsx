import { useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { ReasoningEffort } from '../../services/api/types.js'
import { setReasoningEffort, useSettings } from '../../services/settings.js'
import styles from './EffortSlider.module.css'

/**
 * 推理强度档位（滑块从左到右）：直接对应 Messages API 的 output_config.effort。
 * 官方映射：medium 与 high 实际都按 high 执行（见 effortHintMiddle 文案），
 * 这里仍原样发送用户选中的值，映射关系由服务端决定。
 */
export const EFFORT_LEVELS: ReasoningEffort[] = ['low', 'medium', 'high', 'max']

/** 档位名使用用户指定的英文名，双语界面一致。 */
const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Middle',
  high: 'High',
  max: 'Max',
}

const HINT_KEYS: Record<ReasoningEffort, TranslationKey> = {
  low: 'effortHintLow',
  medium: 'effortHintMiddle',
  high: 'effortHintHigh',
  max: 'effortHintMax',
}

const clampIndex = (value: number): number => Math.min(3, Math.max(0, value))

/**
 * 推理强度滑块：拖动时旋钮与填充跟随手指，松手后快速吸附到最近档位；
 * 点按轨道任意位置也会选中最近档位。深度解析关闭时禁用（强度只在思考模式生效）。
 * 颜色随档位从蓝变紫，Max 档带轻量光晕（纯 CSS，无 WebGL）。
 */
export const EffortSlider = () => {
  const t = useTranslate()
  const thinking = useSettings((state) => state.thinking)
  const effort = useSettings((state) => state.reasoningEffort)
  const trackRef = useRef<HTMLDivElement>(null)
  // 拖动中的连续位置（0-3）；null 表示未拖动，显示已提交的档位。
  const [dragValue, setDragValue] = useState<number | null>(null)

  const disabled = !thinking
  const committedIndex = EFFORT_LEVELS.indexOf(effort)
  const displayValue = dragValue ?? committedIndex
  const displayIndex = Math.round(clampIndex(displayValue))
  const displayLevel = EFFORT_LEVELS[displayIndex]

  const valueFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) {
      return committedIndex
    }
    return clampIndex(((clientX - rect.left) / rect.width) * 3)
  }

  const commit = (value: number) => {
    setReasoningEffort(EFFORT_LEVELS[Math.round(clampIndex(value))])
  }

  return (
    <div
      className={styles.effort}
      data-level={displayIndex}
      data-dragging={dragValue !== null}
      data-disabled={disabled}
    >
      <div className={styles.header}>
        <span className={styles.title}>{t('effortLabel')}</span>
        <span className={styles.status}>
          {disabled
            ? t('effortDisabledHint')
            : `${EFFORT_LABELS[displayLevel]} · ${t(HINT_KEYS[displayLevel])}`}
        </span>
      </div>
      <div
        ref={trackRef}
        className={styles.track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t('effortLabel')}
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={displayIndex}
        aria-valuetext={EFFORT_LABELS[displayLevel]}
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
        <div className={styles.rail} />
        <div className={styles.fill} style={{ width: `${(displayValue / 3) * 100}%` }} />
        {EFFORT_LEVELS.map((level, index) => (
          <span
            key={level}
            aria-hidden
            className={styles.tick}
            style={{ left: `${(index / 3) * 100}%` }}
          />
        ))}
        <div className={styles.knob} style={{ left: `${(displayValue / 3) * 100}%` }} />
      </div>
      <div className={styles.tickLabels} aria-hidden>
        {EFFORT_LEVELS.map((level, index) => (
          <span
            key={level}
            className={index === displayIndex ? styles.tickLabelActive : undefined}
          >
            {EFFORT_LABELS[level]}
          </span>
        ))}
      </div>
    </div>
  )
}
