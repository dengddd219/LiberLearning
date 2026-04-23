import posthog from 'posthog-js'

export function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined
  if (!key) return
  posthog.init(key, {
    api_host: 'https://app.posthog.com',
    autocapture: false,
    capture_pageview: false,
  })
}

export function capture(event: string, props?: Record<string, unknown>) {
  try {
    posthog.capture(event, props)
  } catch {
    // never let analytics crash the app
  }
}
