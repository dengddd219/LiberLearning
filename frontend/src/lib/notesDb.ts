import { MY_NOTES_STORE, openAskDB, PAGE_CHAT_STORE, STORE_NAME } from './askDb'
import type { AskMessage, PageChatMessage } from './notesTypes'

export function askKey(sessionId: string, pageNum: number, bulletIndex: number) {
  return `${sessionId}:${pageNum}:${bulletIndex}`
}

export function myNoteKey(sessionId: string, pageNum: number) {
  return `${sessionId}:${pageNum}`
}

export async function loadMyNote(sessionId: string, pageNum: number): Promise<string> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(MY_NOTES_STORE, 'readonly')
    const req = tx.objectStore(MY_NOTES_STORE).get(myNoteKey(sessionId, pageNum))
    req.onsuccess = () => resolve(req.result?.text ?? '')
    req.onerror = () => resolve('')
  })
}

export async function saveMyNote(sessionId: string, pageNum: number, text: string) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(MY_NOTES_STORE, 'readwrite')
    tx.objectStore(MY_NOTES_STORE).put({ text }, myNoteKey(sessionId, pageNum))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function loadPageChat(sessionId: string, pageNum: number): Promise<PageChatMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(PAGE_CHAT_STORE, 'readonly')
    const req = tx.objectStore(PAGE_CHAT_STORE).get(myNoteKey(sessionId, pageNum))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

export async function savePageChat(sessionId: string, pageNum: number, messages: PageChatMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(PAGE_CHAT_STORE, 'readwrite')
    tx.objectStore(PAGE_CHAT_STORE).put({ messages }, myNoteKey(sessionId, pageNum))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function loadAskHistory(sessionId: string, pageNum: number, bulletIndex: number): Promise<AskMessage[]> {
  const db = await openAskDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(askKey(sessionId, pageNum, bulletIndex))
    req.onsuccess = () => resolve(req.result?.messages ?? [])
    req.onerror = () => resolve([])
  })
}

export async function saveAskHistory(sessionId: string, pageNum: number, bulletIndex: number, messages: AskMessage[]) {
  const db = await openAskDB()
  return new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ messages }, askKey(sessionId, pageNum, bulletIndex))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}
