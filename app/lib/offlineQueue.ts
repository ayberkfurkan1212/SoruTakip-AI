// lib/offlineQueue.ts
// Offline iken yapılan işlemleri IndexedDB'de kuyruğa alır, internet gelince gönderilir.

const DB_NAME = 'soru_takip_offline'
const DB_VERSION = 1
const STORE_NAME = 'kuyruk'

export type KuyrukTipi = 'gunluk_kayit' | 'deneme_sonucu' | 'hata_defteri_foto'

export interface KuyrukKaydi {
  id: string
  tip: KuyrukTipi
  veri: any
  foto?: Blob
  olusturulma: number
  durum: 'bekliyor' | 'gonderiliyor' | 'hata'
  hataMesaji?: string
}

function uuidUret(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function dbAc(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function kuyrugaEkle(
  kayit: Omit<KuyrukKaydi, 'id' | 'olusturulma' | 'durum'>
): Promise<string> {
  const db = await dbAc()
  const id = uuidUret()
  const tamKayit: KuyrukKaydi = { ...kayit, id, olusturulma: Date.now(), durum: 'bekliyor' }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(tamKayit)
    tx.oncomplete = () => resolve(id)
    tx.onerror = () => reject(tx.error)
  })
}

export async function kuyrukOku(): Promise<KuyrukKaydi[]> {
  const db = await dbAc()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function kuyruktanSil(id: string): Promise<void> {
  const db = await dbAc()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function kuyrukGuncelle(id: string, degisiklik: Partial<KuyrukKaydi>): Promise<void> {
  const db = await dbAc()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const mevcut = getReq.result
      if (mevcut) store.put({ ...mevcut, ...degisiklik })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function bekleyenSayisi(): Promise<number> {
  const kayitlar = await kuyrukOku()
  return kayitlar.filter(k => k.durum !== 'gonderiliyor').length
}

// Bir Supabase insert işlemini dener; başarısız olursa (offline ya da ağ hatası)
// kaydı otomatik olarak kuyruğa atar. UI tarafında "online mı offline mı" diye
// ayrı kontrol yazmaya gerek bırakmaz.
export async function cevrimdisiDestekliKayit(
  tip: KuyrukTipi,
  veri: any,
  insertFn: () => Promise<{ error: any }>,
  foto?: Blob
): Promise<{ kuyruga: boolean; hata?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await kuyrugaEkle({ tip, veri, foto })
    return { kuyruga: true }
  }
  try {
    const { error } = await insertFn()
    if (error) {
      // Sunucuya ulaşamama (ağ hatası) ile gerçek veri hatasını ayırt etmeye çalış
      await kuyrugaEkle({ tip, veri, foto })
      return { kuyruga: true, hata: error.message }
    }
    return { kuyruga: false }
  } catch (e: any) {
    await kuyrugaEkle({ tip, veri, foto })
    return { kuyruga: true, hata: String(e) }
  }
}