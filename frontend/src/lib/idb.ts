import { openDB, type DBSchema } from 'idb'

interface LiberStudyDB extends DBSchema {
  sessions: {
    key: string
    value: {
      id: string
      status: 'recording' | 'draft' | 'processing' | 'ready'
      pptFileName?: string
      createdAt: number
      updatedAt: number
    }
  }
  audioChunks: {
    key: [string, number]
    value: {
      sessionId: string
      chunkIndex: number
      blob: Blob
      timestamp: number
    }
    indexes: { bySession: string }
  }
  annotations: {
    key: string
    value: {
      id: string
      sessionId: string
      pageNum: number
      text: string
      yPosition: number
      timestamp: number
    }
    indexes: { bySession: string; byPage: [string, number] }
  }
  notes: {
    key: string
    value: {
      sessionId: string
      data: unknown
      savedAt: number
    }
  }
}

const DB_NAME = 'liberstudy'
const DB_VERSION = 1

function getDB() {
  return openDB<LiberStudyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('audioChunks')) {
        const audioStore = db.createObjectStore('audioChunks', { keyPath: ['sessionId', 'chunkIndex'] })
        audioStore.createIndex('bySession', 'sessionId')
      }

      if (!db.objectStoreNames.contains('annotations')) {
        const annotationStore = db.createObjectStore('annotations', { keyPath: 'id' })
        annotationStore.createIndex('bySession', 'sessionId')
        annotationStore.createIndex('byPage', ['sessionId', 'pageNum'])
      }

      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'sessionId' })
      }
    },
  })
}

export async function saveSession(session: LiberStudyDB['sessions']['value']) {
  const db = await getDB()
  await db.put('sessions', session)
}

export async function getSession(id: string) {
  const db = await getDB()
  return db.get('sessions', id)
}

export async function getIncompleteSession() {
  const db = await getDB()
  const all = await db.getAll('sessions')
  return all.find(s => s.status === 'recording' || s.status === 'draft')
}

export async function saveAudioChunk(sessionId: string, chunkIndex: number, blob: Blob) {
  const db = await getDB()
  await db.put('audioChunks', { sessionId, chunkIndex, blob, timestamp: Date.now() })
}

export async function getAudioChunks(sessionId: string) {
  const db = await getDB()
  return db.getAllFromIndex('audioChunks', 'bySession', sessionId)
}

export async function saveAnnotation(annotation: LiberStudyDB['annotations']['value']) {
  const db = await getDB()
  await db.put('annotations', annotation)
}

export async function getAnnotationsByPage(sessionId: string, pageNum: number) {
  const db = await getDB()
  return db.getAllFromIndex('annotations', 'byPage', [sessionId, pageNum])
}

export async function saveNotes(sessionId: string, data: unknown) {
  const db = await getDB()
  await db.put('notes', { sessionId, data, savedAt: Date.now() })
}

export async function getNotes(sessionId: string) {
  const db = await getDB()
  return db.get('notes', sessionId)
}

export async function clearSession(sessionId: string) {
  const db = await getDB()
  await db.delete('sessions', sessionId)
  const chunks = await db.getAllFromIndex('audioChunks', 'bySession', sessionId)
  for (const chunk of chunks) {
    await db.delete('audioChunks', [chunk.sessionId, chunk.chunkIndex])
  }
  const annotations = await db.getAllFromIndex('annotations', 'bySession', sessionId)
  for (const ann of annotations) {
    await db.delete('annotations', ann.id)
  }
  await db.delete('notes', sessionId)
}
