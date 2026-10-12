import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseMiddlewareClient } from './app/lib/supabase-middleware'

const KORUNAN_ROTALAR = [
  '/dashboard', '/rapor', '/takvim', '/net', '/pomodoro',
  '/hesap', '/veli', '/admin', '/deneme', '/kurum', '/ogretmen',
  '/premium', '/ai-koc', '/hata-defteri'
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Korunan rota mu kontrol et
  const korunanRota = KORUNAN_ROTALAR.some(rota => pathname.startsWith(rota))
  if (!korunanRota) return NextResponse.next()

  // Veli, kurum, öğretmen panelleri kendi localStorage kontrolü yapıyor
  // Sadece öğrenci sayfaları için Supabase session kontrolü
  // Veli paneli: imzalı oturum çerezi yoksa girişe yönlendir (asıl doğrulama API'de)
  if (pathname === '/veli' || pathname.startsWith('/veli/')) {
    if (!request.cookies.get('veli_oturum')?.value) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  const ogrenciRotalari = ['/dashboard', '/rapor', '/takvim', '/net', '/pomodoro', '/hesap', '/admin', '/deneme', '/premium', '/ai-koc', '/hata-defteri']
  const ogrenciRotasi = ogrenciRotalari.some(rota => pathname.startsWith(rota))

  if (ogrenciRotasi) {
    const { supabase, supabaseResponse } = createSupabaseMiddlewareClient(request)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }

    return supabaseResponse
  }

  // Veli, kurum, öğretmen için basit yönlendirme (localStorage kontrolü client'ta)
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*', '/rapor/:path*', '/takvim/:path*',
    '/net/:path*', '/pomodoro/:path*', '/hesap/:path*',
    '/veli/:path*', '/admin/:path*', '/deneme/:path*',
    '/kurum/:path*', '/ogretmen/:path*',
    '/premium/:path*', '/ai-koc/:path*', '/hata-defteri/:path*'
  ]
}