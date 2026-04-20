export const ASK_DB_NAME = 'liberstudy_ask'
export const ASK_DB_VERSION = 3
export const STORE_NAME = 'ask_history'
export const MY_NOTES_STORE = 'my_notes'
export const PAGE_CHAT_STORE = 'page_chat'

export function openAskDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ASK_DB_NAME, ASK_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(MY_NOTES_STORE)) {
        db.createObjectStore(MY_NOTES_STORE)
      }
      if (!db.objectStoreNames.contains(PAGE_CHAT_STORE)) {
        db.createObjectStore(PAGE_CHAT_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
