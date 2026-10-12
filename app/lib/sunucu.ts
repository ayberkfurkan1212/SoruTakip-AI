// app/lib/sunucu.ts
// Sadece sunucu tarafında (route handler) kullanılacak ortak yardımcılar.
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from './supabase-server'

let _admin: SupabaseClient | null = null

/** Service role client — RLS'i atlar, sadece doğrulanmış isteklerde kullan. */
export function adminClient(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  }
  return _admin
}

/** İstemci IP'si (rate limit anahtarı için). */
export function ipAl(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'anonim'
}

/** HTML e-postalara kullanıcı verisi gömerken kaçış. */
export function htmlKacis(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface OturumOgrenci {
  authId: string
  ogrenci: {
    id: string
    ad: string
    soyad: string
    email: string
    veli_email: string | null
  }
}

/**
 * İsteği yapan öğrenciyi bulur. Önce `Authorization: Bearer <token>`,
 * yoksa Supabase oturum çerezine bakar. Bulamazsa null döner.
 */
export async function oturumOgrenci(req: NextRequest): Promise<OturumOgrenci | null> {
  let authId: string | null = null

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data } = await adminClient().auth.getUser(token)
    authId = data.user?.id ?? null
  }

  if (!authId) {
    try {
      const supabase = await createSupabaseServerClient()
      const { data } = await supabase.auth.getUser()
      authId = data.user?.id ?? null
    } catch {
      authId = null
    }
  }

  if (!authId) return null

  const { data: ogrenci } = await adminClient()
    .from('ogrenciler')
    .select('id, ad, soyad, email, veli_email')
    .eq('auth_id', authId)
    .maybeSingle()

  if (!ogrenci) return null
  return { authId, ogrenci }
}

/** Öğrencinin şu an premium (ücretli veya deneme) olup olmadığını döner. */
export async function premiumMu(ogrenciId: string): Promise<boolean> {
  const { data, error } = await adminClient().rpc('premium_mi', { p_ogrenci_id: ogrenciId })
  // Premium altyapısı veritabanına henüz kurulmadıysa kimseyi kısıtlama
  if (error) return true
  return data === true
}

// ─── Veli oturumu (imzalı, httpOnly çerez) ──────────────────────────────────

export const VELI_CEREZ = 'veli_oturum'
const VELI_OTURUM_SURE_SN = 60 * 60 * 24 * 30 // 30 gün

function veliAnahtar(): Buffer {
  const kaynak = process.env.VELI_OTURUM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return crypto.createHash('sha256').update('veli-oturum:' + kaynak).digest()
}

export interface VeliOturum { veliId: string; ogrenciId: string; exp: number }

export function veliOturumImzala(veliId: string, ogrenciId: string): string {
  const veri: VeliOturum = { veliId, ogrenciId, exp: Math.floor(Date.now() / 1000) + VELI_OTURUM_SURE_SN }
  const govde = Buffer.from(JSON.stringify(veri)).toString('base64url')
  const imza = crypto.createHmac('sha256', veliAnahtar()).update(govde).digest('base64url')
  return `${govde}.${imza}`
}

export function veliOturumCoz(deger: string | undefined | null): VeliOturum | null {
  if (!deger) return null
  const [govde, imza] = deger.split('.')
  if (!govde || !imza) return null
  const beklenen = crypto.createHmac('sha256', veliAnahtar()).update(govde).digest('base64url')
  const a = Buffer.from(imza)
  const b = Buffer.from(beklenen)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const veri = JSON.parse(Buffer.from(govde, 'base64url').toString()) as VeliOturum
    if (!veri.veliId || !veri.ogrenciId || veri.exp < Date.now() / 1000) return null
    return veri
  } catch {
    return null
  }
}

/** İstekteki veli çerezini doğrular ve velinin hâlâ var olduğunu kontrol eder. */
export async function veliOturumAl(req: NextRequest): Promise<VeliOturum | null> {
  const oturum = veliOturumCoz(req.cookies.get(VELI_CEREZ)?.value)
  if (!oturum) return null
  const { data } = await adminClient()
    .from('veliler')
    .select('id')
    .eq('id', oturum.veliId)
    .eq('ogrenci_id', oturum.ogrenciId)
    .maybeSingle()
  return data ? oturum : null
}

export const veliCerezAyar = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: VELI_OTURUM_SURE_SN,
}
