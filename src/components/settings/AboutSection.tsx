import clsx from 'clsx'
import { Fragment, useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { APP_VERSION, OFFICIAL_PRICING_URL, REPO_URL } from '../../version.js'
import { setGithubProxyPrefix, useSettings } from '../../services/settings.js'
import {
  DIRECT_GITHUB_PROXY,
  normalizeGithubProxy,
  resolveGithubProxy,
} from '../../services/githubProxy.js'
import { isPeakNow, loadPrices, usePrices } from '../../services/pricing.js'
import type { ChatModel } from '../../services/api/types.js'
import {
  checkForUpdate,
  openUpdateDialog,
  useUpdateStore,
} from '../../services/update.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/** 与 README「反馈与联系」一致的联系方式。 */
const CONTACT_EMAIL = '2012990260@qq.com'
const CONTACT_QQ_GROUP = '1107601781'

/** 关于分组：版本与检查更新、GitHub 加速、价格表、致谢、联系方式与声明。 */
export const AboutSection = () => (
  <>
    <UpdateRow />
    <GithubProxyField />
    <PriceTable />
    <Credits />
    <ContactRow
      labelKey="aboutContactEmail"
      value={CONTACT_EMAIL}
    />
    <ContactRow labelKey="aboutContactQq" value={CONTACT_QQ_GROUP} />
    <RepoRow />
    <Disclaimer />
  </>
)

const UpdateRow = () => {
  const t = useTranslate()
  const [checking, setChecking] = useState(false)

  const onCheck = async () => {
    if (checking) {
      return
    }
    setChecking(true)
    try {
      const result = await checkForUpdate(true)
      if (result === 'current') {
        showToast({ key: 'updateUpToDate' })
      } else if (result === 'error') {
        showToast({ key: 'updateCheckFailed', type: 'error' })
      } else if (result === 'no-apk') {
        showToast({ key: 'updateNoApk', type: 'error' })
      } else if (result === 'desktop') {
        // Desktop: the releases page was opened in the system browser.
      } else {
        const release = useUpdateStore.getState().latestRelease
        if (release) {
          openUpdateDialog(release)
        }
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className={clsx(styles.cell, styles.row)}>
      <div className={styles.text}>
        <div className={styles.label}>{t('currentVersion')}</div>
        <div className={styles.description}>{APP_VERSION}</div>
      </div>
      <Button
        variant="outlined"
        size="m"
        className={styles.cellButton}
        disabled={checking}
        onClick={() => void onCheck()}
      >
        {t(checking ? 'updateChecking' : 'checkUpdate')}
      </Button>
    </div>
  )
}

/** GitHub accelerator: only affects GitHub file downloads (APK, prices.json). Unset means the built-in default; saving an empty input means a direct connection (no proxy). */
const GithubProxyField = () => {
  const t = useTranslate()
  const saved = useSettings((state) => state.githubProxyPrefix)
  const resolved = resolveGithubProxy(saved)
  const [draft, setDraft] = useState(resolved.mode === 'custom' ? resolved.prefix : '')
  const [error, setError] = useState(false)

  // The input holds a custom prefix only; default/direct modes show an empty
  // input, with the effective value in the status line below. Re-sync when
  // the saved value changes (restore-default / direct buttons).
  useEffect(() => {
    const current = resolveGithubProxy(saved)
    setDraft(current.mode === 'custom' ? current.prefix : '')
    setError(false)
  }, [saved])

  const save = () => {
    const normalized = normalizeGithubProxy(draft)
    if (normalized === null) {
      setError(true)
      return
    }
    setError(false)
    // An empty input clears to a direct connection, stored as the 'direct'
    // sentinel so it never falls back to the built-in default.
    setGithubProxyPrefix(normalized === '' ? DIRECT_GITHUB_PROXY : normalized)
    showToast({ key: 'githubProxySaved' })
  }

  const restoreDefault = () => {
    setGithubProxyPrefix('')
    showToast({ key: 'githubProxySaved' })
  }

  const useDirect = () => {
    setGithubProxyPrefix(DIRECT_GITHUB_PROXY)
    showToast({ key: 'githubProxySaved' })
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('githubProxyLabel')}</div>
        <div className={styles.description}>{t('githubProxyDescription')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="url"
            placeholder={t('githubProxyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                save()
              }
            }}
          />
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.confirm}
            // Keep the input focused, same as the API Key confirm button.
            onMouseDown={(event) => event.preventDefault()}
            onClick={save}
          >
            {t('confirm')}
          </button>
        </div>
        <div className={styles.description}>
          {resolved.mode === 'direct'
            ? t('githubProxyEffectiveDirect')
            : t(
                resolved.mode === 'default'
                  ? 'githubProxyEffectiveDefault'
                  : 'githubProxyEffectiveCustom',
                { proxy: resolved.prefix }
              )}
        </div>
        <div className={styles.proxyActions}>
          <Button
            variant="outlined"
            size="s"
            disabled={resolved.mode === 'default'}
            onClick={restoreDefault}
          >
            {t('githubProxyUseDefault')}
          </Button>
          <Button
            variant="outlined"
            size="s"
            disabled={resolved.mode === 'direct'}
            onClick={useDirect}
          >
            {t('githubProxyUseDirect')}
          </Button>
        </div>
        {error ? <div className={styles.error}>{t('githubProxyInvalid')}</div> : null}
      </div>
    </div>
  )
}

const modelRows: { model: ChatModel; label: string }[] = [
  { model: 'deepseek-flash', label: 'deepseek-flash' },
  { model: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
]

const PriceTable = () => {
  const t = useTranslate()
  const table = usePrices((state) => state.table)
  const source = usePrices((state) => state.source)
  useEffect(() => {
    void loadPrices()
  }, [])
  const peak = isPeakNow()
  const searchPerThousand = Math.round(table.webSearchPerRequest * 1000 * 100) / 100

  return (
    <div className={styles.cell}>
      <div className={styles.aboutBlock}>
        <div className={styles.label}>{t('priceTableTitle')}</div>
        <div className={styles.description}>
          {t(source === 'online' ? 'priceSourceOnline' : 'priceSourceBundled', {
            date: table.effectiveDate,
          })}
          {' · '}
          <span className={peak ? styles.pricePeak : styles.priceOffPeak}>
            {t(peak ? 'pricePeakNow' : 'priceOffPeakNow')}
          </span>
        </div>
        <div className={styles.priceTableWrap}>
          <table className={styles.priceTable}>
            <thead>
              <tr>
                <th>{t('priceModel')}</th>
                <th>{t('pricePeriod')}</th>
                <th>{t('priceInputMiss')}</th>
                <th>{t('priceInputHit')}</th>
                <th>{t('priceOutput')}</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((row) => {
                const prices = table.models[row.model]
                return (
                  <Fragment key={row.model}>
                    <tr>
                      <td rowSpan={2}>{row.label}</td>
                      <td className={styles.priceOffPeak}>{t('pricePeriodOffPeak')}</td>
                      <td>{prices.inputCacheMiss.offPeak}</td>
                      <td>{prices.inputCacheHit.offPeak}</td>
                      <td>{prices.output.offPeak}</td>
                    </tr>
                    <tr>
                      <td className={styles.pricePeak}>{t('pricePeriodPeak')}</td>
                      <td>{prices.inputCacheMiss.peak}</td>
                      <td>{prices.inputCacheHit.peak}</td>
                      <td>{prices.output.peak}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.description}>
          {t('priceWebSearch', { price: searchPerThousand })}
        </div>
        <div className={styles.description}>
          {t('priceContextWindow', { count: table.contextWindow.toLocaleString() })}
        </div>
        <a
          className={styles.aboutLink}
          href={OFFICIAL_PRICING_URL}
          target="_blank"
          rel="noreferrer"
        >
          {t('priceOfficialNote')}
        </a>
      </div>
    </div>
  )
}

/** 致谢：文案与 README 致谢部分一致。 */
const Credits = () => {
  const t = useTranslate()
  return (
    <div className={styles.cell}>
      <div className={styles.aboutBlock}>
        <div className={styles.label}>{t('aboutCreditsTitle')}</div>
        <p className={styles.aboutText}>{t('aboutCreditUpstream')}</p>
        <p className={styles.aboutText}>{t('aboutCreditApi')}</p>
        <p className={styles.aboutText}>{t('aboutCreditCapacitor')}</p>
      </div>
    </div>
  )
}

const ContactRow = ({
  labelKey,
  value,
}: {
  labelKey: 'aboutContactEmail' | 'aboutContactQq'
  value: string
}) => {
  const t = useTranslate()
  const onCopy = async () => {
    const ok = await copyText(value)
    showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
  }
  return (
    <div className={clsx(styles.cell, styles.row)}>
      <div className={styles.text}>
        <div className={styles.label}>{t(labelKey)}</div>
      </div>
      <Button
        variant="outlined"
        size="m"
        className={styles.cellButton}
        onClick={() => void onCopy()}
      >
        {t('copy')}
      </Button>
    </div>
  )
}

const RepoRow = () => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row)}>
      <div className={styles.text}>
        <div className={styles.label}>{t('aboutRepoLink')}</div>
      </div>
      <a className={styles.aboutLink} href={REPO_URL} target="_blank" rel="noreferrer">
        {REPO_URL}
      </a>
    </div>
  )
}

const Disclaimer = () => {
  const t = useTranslate()
  return (
    <div className={styles.cell}>
      <p className={styles.aboutText}>{t('aboutDisclaimer')}</p>
    </div>
  )
}
