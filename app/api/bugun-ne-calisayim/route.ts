// app/api/bugun-ne-calisayim/route.ts
// Ana sayfadaki "Bugün ne çalışayım?" önerisi. Veriyi sunucuda okur, AI kotasından düşer.
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminClient, oturumOgrenci, premiumMu } from '../../lib/sunucu'
import { aiKotaKullan, kotaDoluMesaj } from '../../lib/aiKota'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const runtime = 'nodejs'
export const maxDuration = 60

function istanbulTarih(gunOnce = 0): string {
  const d = new Date(Date.now() - gunOnce * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
}

export async function POST(req: NextRequest) {
  const oturum = await oturumOgrenci(req)
  if (!oturum) return NextResponse.json({ error: 'Giriş yapmalısın.' }, { status: 401 })
  const ogrenciId = oturum.ogrenci.id

  const { data: kayitlar } = await adminClient()
    .from('gunluk_kayitlar')
    .select('tarih, ders, konu, sinav_turu, dogru_sayisi, yanlis_sayisi, bos_sayisi')
    .eq('ogrenci_id', ogrenciId)
    .gte('tarih', istanbulTarih(14))
    .order('tarih', { ascending: false })
    .limit(500)

  if (!kayitlar || kayitlar.length === 0) {
    return NextResponse.json({ error: 'Öneri için son 14 günde en az bir kayıt girmelisin.' }, { status: 400 })
  }

  // Ders bazlı istatistik (AI'ya ve arayüze)
  const bugun = istanbulTarih(0)
  const dersMap: Record<string, { d: number; y: number; b: number; son: string }> = {}
  for (const k of kayitlar) {
    const m = (dersMap[k.ders] ??= { d: 0, y: 0, b: 0, son: k.tarih })
    m.d += k.dogru_sayisi || 0; m.y += k.yanlis_sayisi || 0; m.b += k.bos_sayisi || 0
    if (k.tarih > m.son) m.son = k.tarih
  }
  const dersler = Object.entries(dersMap).map(([ders, m]) => {
    const toplam = m.d + m.y + m.b
    const ara = Math.round((new Date(bugun).getTime() - new Date(m.son).getTime()) / 86_400_000)
    return { ders, basari: toplam ? Math.round((m.d / toplam) * 100) : 0, ara }
  })
  const enDusuk = [...dersler].sort((a, b) => a.basari - b.basari)[0]
  const enUzun = [...dersler].sort((a, b) => b.ara - a.ara)[0]
  const istatistik = {
    enDusukBasari: enDusuk ? { ders: enDusuk.ders, basari: enDusuk.basari } : null,
    enUzunAra: enUzun && enUzun.ara > 0 ? { ders: enUzun.ders, gun: enUzun.ara } : null,
  }

  const premium = await premiumMu(ogrenciId)
  const kota = await aiKotaKullan(ogrenciId, 'koc', premium)
  if (!kota.izin) return NextResponse.json({ ...kotaDoluMesaj('koc', premium, kota.sifirlanma), istatistik }, { status: 402 })

  const ozet = kayitlar.slice(0, 150).map(k => {
    const t = (k.dogru_sayisi || 0) + (k.yanlis_sayisi || 0) + (k.bos_sayisi || 0)
    const basari = t ? Math.round(((k.dogru_sayisi || 0) / t) * 100) : 0
    return `${k.tarih} | ${k.sinav_turu} ${k.ders} - ${k.konu}: ${k.dogru_sayisi}D ${k.yanlis_sayisi}Y ${k.bos_sayisi}B (%${basari})`
  }).join('\n')

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Sen bir TYT/AYT hazırlık koçusun. Öğrencinin son 14 günlük verilerine bakarak BUGÜN ne çalışması gerektiğini söyle.

Öğrenci: ${oturum.ogrenci.ad}
Bugün: ${bugun}

Son 14 günlük kayıtlar:
${ozet}

Sadece şu JSON'u döndür:
{"oncelikliDers":"","oncelikliKonu":"","neden":"1-2 cümle, veriye dayalı","hedef":"somut hedef (örn: 40 soru, %70 başarı)","ekDers":"ikinci öncelik ya da null","motivasyon":"kısa, samimi bir cümle"}

Kurallar: En düşük başarılı konuya ve uzun süredir çalışılmayan derse öncelik ver. Bugün zaten çalışılmış dersi önerme. Türkçe yaz.`,
      }],
    })
    const text = message.content[0]?.type === 'text' ? message.content[0].text : ''
    const json = text.match(/\{[\s\S]*\}/)
    if (!json) throw new Error('JSON yok')
    return NextResponse.json({ oneri: JSON.parse(json[0]), istatistik })
  } catch (e) {
    console.error('Bugün ne çalışayım hatası:', e)
    return NextResponse.json({ error: 'Öneri alınamadı, tekrar dene.', istatistik }, { status: 500 })
  }
}
