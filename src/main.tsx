import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const serviceWorkerUpdateCheckInterval = 60 * 60 * 1000

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let lastServiceWorkerUpdateCheck = 0
  let serviceWorkerRegistration: ServiceWorkerRegistration | undefined

  const checkForServiceWorkerUpdate = async () => {
    if (!serviceWorkerRegistration) {
      return
    }

    const now = Date.now()

    if (now - lastServiceWorkerUpdateCheck < serviceWorkerUpdateCheckInterval) {
      return
    }

    lastServiceWorkerUpdateCheck = now
    await serviceWorkerRegistration?.update()
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        serviceWorkerRegistration = registration
        void checkForServiceWorkerUpdate()
      })
      .catch((error: unknown) => {
        console.error('Service worker registration failed', error)
      })
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForServiceWorkerUpdate()
    }
  })
}
