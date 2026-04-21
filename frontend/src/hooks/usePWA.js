import { useEffect, useMemo, useState } from 'react'

export function usePWA() {
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  }, [])

  useEffect(() => {
    setIsInstalled(isStandalone)
  }, [isStandalone])

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPromptEvent(event)
    }

    const onAppInstalled = () => {
      setIsInstalled(true)
      setInstallPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const promptInstall = async () => {
    if (!installPromptEvent) {
      return false
    }

    installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    setInstallPromptEvent(null)
    return choice?.outcome === 'accepted'
  }

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  const isIos = /iphone|ipad|ipod/.test(userAgent)

  return {
    isInstalled,
    canInstall: Boolean(installPromptEvent),
    isIos,
    promptInstall,
  }
}
