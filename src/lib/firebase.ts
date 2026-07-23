import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

export type FirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

/** Public web SDK config for the deployed GitHub Pages app. */
const PRODUCTION_FIREBASE: FirebaseConfig = {
  apiKey: 'AIzaSyAlQTWVXXRsg9iHd-AUCvazJJvAWPOh-Z8',
  authDomain: 'time-blocker-502417.firebaseapp.com',
  projectId: 'time-blocker-502417',
  appId: '1:597708660954:web:423dc9ab0248c4bce5c5e3',
}

function readEnvConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined
  if (!apiKey || !authDomain || !projectId || !appId) return null
  if (apiKey.includes('your-') || projectId.includes('your-')) return null
  return { apiKey, authDomain, projectId, appId }
}

function readConfig(): FirebaseConfig | null {
  const fromEnv = readEnvConfig()
  if (fromEnv) return fromEnv
  if (import.meta.env.PROD) return PRODUCTION_FIREBASE
  return null
}

/** True when all VITE_FIREBASE_* vars needed by the web SDK are set. */
export function isFirebaseConfigured(): boolean {
  return readConfig() != null
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    const config = readConfig()
    if (!config) {
      throw new Error(
        'Missing Firebase config. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID in .env (see .env.example).',
      )
    }
    app = initializeApp(config)
  }
  return app
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp())
  return auth
}

export function getFirestoreDb(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp())
  return db
}
