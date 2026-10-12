'use client'
import { useEffect, useState, useRef } from 'react'
import { premiumLimitHatasi } from '../lib/plan'
import { supabase } from '../lib/supabase'
import { kuyrukOku, kuyruktanSil, kuyrukGuncelle, bekleyenSayisi, KuyrukKaydi } from '../lib/offlineQueue'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function SyncManager() {
  const [bekleyen, setBekleyen] = useState(0)
  const senkronizeEdiliyorRef = useRef(false)

  const birKaydiGonder = async (kayit: KuyrukKaydi) => {
    if (kayit.tip === 'gunluk_kayit') {
      const { error } = await supabase.from('gunluk_kayitlar').insert(kayit.veri)
      if (error) throw error
    } else if (kayit.tip === 'deneme_sonucu') {
      const { error } = await supabase.from('deneme_sonuclari').insert(kayit.veri)
      if (error) throw error
    } else if (kayit.tip === 'hata_defteri_foto') {
      if (!kayit.foto) throw new Error('Kuyrukta fotoğraf bulunamadı')

      let analiz = kayit.veri?.analiz
      if (!analiz) {
        const base64 = await blobToBase64(kayit.foto)
        const res = await fetch('/api/hata-analiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mediaType: kayit.foto.type }),
        })
        analiz = res.ok ? await res.json() : null
      }

      const dosyaAdi = `${kayit.veri.ogrenci_id}/${Date.now()}-kuyruk.jpg`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('hata-fotograflari')
        .upload(dosyaAdi, kayit.foto)
      if (uploadError) throw uploadError


      const tamAnaliz = analiz
        ? [
            analiz.dogru_cevap ? `Dogru Cevap: ${analiz.dogru_cevap}` : '',
            analiz.cozum_yolu ? `Cozum Yolu:\n${analiz.cozum_yolu}` : '',
            analiz.hata_aciklamasi ? `Muhtemel Hata: ${analiz.hata_aciklamasi}` : '',
          ].filter(Boolean).join('\n\n')
        : null

      const { error } = await supabase.from('hata_defteri').insert({
        ogrenci_id: kayit.veri.ogrenci_id,
        fotograf_url: uploadData.path,
        ders: analiz?.ders || null,
        konu: analiz?.konu || null,
        ai_aciklama: tamAnaliz,
        tekrar_sayisi: 1,
      })
      if (error) throw error
    }
  }

  const senkronizeEt = async () => {
    if (senkronizeEdiliyorRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    senkronizeEdiliyorRef.current = true

    const kayitlar = await kuyrukOku()
    for (const kayit of kayitlar) {
      if (kayit.durum === 'gonderiliyor') continue
      try {
        await kuyrukGuncelle(kayit.id, { durum: 'gonderiliyor' })
        await birKaydiGonder(kayit)
        await kuyruktanSil(kayit.id)
      } catch (e: any) {
        const mesaj = String(e?.message || e)
        if (premiumLimitHatasi(mesaj)) {
          // Ücretsiz plan limiti kalıcı bir durum: tekrar denemenin anlamı yok
          await kuyruktanSil(kayit.id)
        } else {
          await kuyrukGuncelle(kayit.id, { durum: 'hata', hataMesaji: mesaj })
        }
      }
    }

    setBekleyen(await bekleyenSayisi())
    senkronizeEdiliyorRef.current = false
  }

  useEffect(() => {
    // Sayfa açılınca kuyruğu oku ve hemen senkronize et
    bekleyenSayisi().then(setBekleyen)
    senkronizeEt()

    const gorunurlukDegisti = () => {
      if (document.visibilityState === 'visible') {
        bekleyenSayisi().then(setBekleyen)
        senkronizeEt()
      }
    }

    // Her 15 saniyede bir kuyruk kontrolü — rozet anında güncellenir,
    // online event kaçırılsa bile en geç 15sn içinde senkronize olur
    const interval = setInterval(() => {
      bekleyenSayisi().then(setBekleyen)
      senkronizeEt()
    }, 15000)

    window.addEventListener('online', () => {
      bekleyenSayisi().then(setBekleyen)
      senkronizeEt()
    })
    document.addEventListener('visibilitychange', gorunurlukDegisti)

    return () => {
      window.removeEventListener('online', senkronizeEt)
      document.removeEventListener('visibilitychange', gorunurlukDegisti)
      clearInterval(interval)
    }
  }, [])

  if (bekleyen === 0) return null

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-amber-900/90 border border-amber-700/50 text-amber-200 text-xs px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 backdrop-blur">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      {bekleyen} kayıt internet gelince gönderilecek
    </div>
  )
}