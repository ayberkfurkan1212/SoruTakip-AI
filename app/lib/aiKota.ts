// app/lib/aiKota.ts
// Öğrenci başına AI kullanım kotası (Upstash Redis). Ücretsiz ve premium için ayrı pencereler.
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { PREMIUM_LIMIT, UCRETSIZ_LIMIT } from './plan'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export type AiTur = 'koc' | 'hata'

const limitciler = {
  koc: {
    ucretsiz: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(UCRETSIZ_LIMIT.aiKocHaftalik, '7 d'), prefix: 'rl:ai:koc:u' }),
    premium: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(PREMIUM_LIMIT.aiKocGunluk, '1 d'), prefix: 'rl:ai:koc:p' }),
  },
  hata: {
    ucretsiz: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(UCRETSIZ_LIMIT.hataAnalizHaftalik, '7 d'), prefix: 'rl:ai:hata:u' }),
    premium: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(PREMIUM_LIMIT.hataAnalizGunluk, '1 d'), prefix: 'rl:ai:hata:p' }),
  },
}

export interface KotaSonuc { izin: boolean; kalan: number; sifirlanma: number }

/** Bir AI hakkı kullanır. İzin yoksa hak düşmez. */
export async function aiKotaKullan(ogrenciId: string, tur: AiTur, premium: boolean): Promise<KotaSonuc> {
  const limitci = limitciler[tur][premium ? 'premium' : 'ucretsiz']
  const { success, remaining, reset } = await limitci.limit(ogrenciId)
  return { izin: success, kalan: remaining, sifirlanma: reset }
}

/** Hak kullanmadan kalan miktarı döner. */
export async function aiKotaDurum(ogrenciId: string, tur: AiTur, premium: boolean): Promise<KotaSonuc> {
  const limitci = limitciler[tur][premium ? 'premium' : 'ucretsiz']
  const { remaining, reset } = await limitci.getRemaining(ogrenciId)
  return { izin: remaining > 0, kalan: remaining, sifirlanma: reset }
}

/** Kota dolduğunda istemciye dönecek standart yanıt gövdesi. */
export function kotaDoluMesaj(tur: AiTur, premium: boolean, sifirlanma: number) {
  const ne = tur === 'koc' ? 'AI Koç' : 'AI soru çözümü'
  const ne_zaman = new Date(sifirlanma).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
  return premium
    ? { error: `Bugünkü ${ne} kullanım hakkın doldu. ${ne_zaman} sonrası tekrar deneyebilirsin.`, kotaDoldu: true }
    : { error: `Ücretsiz planda ${ne} hakkın doldu. Premium ile her gün kullanabilirsin.`, kotaDoldu: true, premiumGerekli: true, sifirlanma: ne_zaman }
}
