// app/lib/plan.ts
// Premium plan ayarları — hem istemci hem sunucu kullanır (gizli bilgi içermez).

export type PaketKodu = 'aylik' | 'yks'

/** YKS paketi kurucu fiyatıyla satılacak ilk kişi sayısı */
export const KURUCU_KONTENJAN = 100

export const FIYATLAR = {
  aylik: 99,
  yks: 499,
  yksKurucu: 349,
} as const

export const AYLIK_GUN = 30

/** Ücretsiz plan limitleri (DB trigger'ı ile aynı olmalı: premium_limit_kontrol) */
export const UCRETSIZ_LIMIT = {
  denemeAylik: 4,
  hataAylik: 20,
  raporHafta: 4,
  aiKocHaftalik: 1,
  hataAnalizHaftalik: 3,
} as const

/** Premium adil kullanım limitleri (günlük) */
export const PREMIUM_LIMIT = {
  aiKocGunluk: 10,
  hataAnalizGunluk: 20,
} as const

export const DENEME_GUN = 7

/** Ödeme linki kaç gün geçerli */
export const ISTEK_GECERLILIK_GUN = 7

export const PREMIUM_OZELLIKLER: { baslik: string; ucretsiz: string; premium: string }[] = [
  { baslik: 'Günlük soru kaydı', ucretsiz: 'Sınırsız', premium: 'Sınırsız' },
  { baslik: 'Veli paneli', ucretsiz: 'Var', premium: 'Var' },
  { baslik: 'AI Koç analizi', ucretsiz: 'Haftada 1', premium: 'Her gün' },
  { baslik: 'AI soru çözümü (hata defteri)', ucretsiz: 'Haftada 3', premium: 'Her gün' },
  { baslik: 'Rapor geçmişi', ucretsiz: 'Son 4 hafta', premium: 'Tüm geçmiş' },
  { baslik: 'PNG rapor paylaşımı', ucretsiz: '—', premium: 'Var' },
  { baslik: 'Deneme kaydı', ucretsiz: 'Ayda 4', premium: 'Sınırsız' },
  { baslik: 'Hata defteri kaydı', ucretsiz: 'Ayda 20', premium: 'Sınırsız' },
]

/** İki tarih arasındaki tam gün sayısı (yukarı yuvarlar). */
export function kalanGun(bitis: string | Date | null | undefined, simdi = new Date()): number {
  if (!bitis) return 0
  const fark = new Date(bitis).getTime() - simdi.getTime()
  return fark > 0 ? Math.ceil(fark / 86_400_000) : 0
}

/** YKS paketi: sınav gününün sonuna kadar kaç gün? (en az 30) */
export function yksPaketGun(sinavTarihi: string, simdi = new Date()): number {
  const bitis = new Date(`${sinavTarihi}T23:59:59+03:00`)
  return Math.max(AYLIK_GUN, kalanGun(bitis, simdi))
}

export function tlFormat(tutar: number): string {
  return `${tutar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}₺`
}

/** Supabase hata mesajından premium limit türünü çıkarır. */
export function premiumLimitHatasi(mesaj: string | undefined | null): 'deneme' | 'hata' | null {
  const m = mesaj?.match(/PREMIUM_LIMIT:(deneme|hata)/)
  return m ? (m[1] as 'deneme' | 'hata') : null
}
