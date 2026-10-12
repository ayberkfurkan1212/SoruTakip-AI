-- Soru Takip — veritabanı şeması (yalnızca yapı, veri içermez)
-- Supabase / PostgreSQL 17

create extension if not exists pgcrypto;

-- ============================================================
-- Öğrenci ve veli
-- ============================================================

create table public.ogrenciler (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid references auth.users(id) on delete cascade,
  ad text not null,
  soyad text not null,
  email text,
  dogum_tarihi date,
  veli_email text,                       -- 18 yaş altı kayıtta zorunlu
  yks_tarihi date,
  hedef_universite text,
  hedef_bolum text,
  haftalik_hedef_soru integer default 0,
  haftalik_hedef_saat numeric default 0,
  streak_gun integer default 0,
  son_calisma_tarihi date,
  olusturuldu timestamptz default now()
);
create index ogrenciler_auth_id_idx on public.ogrenciler(auth_id);

create table public.veliler (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid references public.ogrenciler(id) on delete cascade,
  ad text not null,
  soyad text not null,
  email text not null unique,
  sifre text,                            -- bcrypt (pgcrypto crypt + gen_salt('bf'))
  olusturuldu timestamptz default now()
);

create table public.veli_davetler (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid not null references public.ogrenciler(id) on delete cascade,
  veli_email text not null,
  token text not null unique,            -- 32 bayt rastgele, hex
  kullanildi boolean default false,
  olusturma_tarihi timestamptz default now(),
  gecerlilik_tarihi timestamptz default (now() + interval '7 days')
);

-- ============================================================
-- Çalışma verisi
-- ============================================================

create table public.gunluk_kayitlar (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid not null references public.ogrenciler(id),
  tarih date not null,
  sinav_turu text check (sinav_turu in ('TYT', 'AYT')),
  ders text not null,
  konu text not null,
  dogru_sayisi integer default 0,
  yanlis_sayisi integer default 0,
  bos_sayisi integer default 0,
  calisma_saati numeric default 0,
  notlar text,
  olusturuldu timestamptz default now()
);
create index gunluk_kayitlar_ogrenci_tarih_idx on public.gunluk_kayitlar(ogrenci_id, tarih);

create table public.deneme_sonuclari (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid not null references public.ogrenciler(id) on delete cascade,
  deneme_adi text not null,
  sinav_turu text not null check (sinav_turu in ('TYT', 'AYT')),
  tarih date not null default current_date,
  ders_netleri jsonb not null,           -- {"Matematik": 28.75, "Türkçe": 33.5, ...}
  toplam_net numeric not null,
  olusturuldu timestamptz default now()
);
create index deneme_sonuclari_ogrenci_idx on public.deneme_sonuclari(ogrenci_id, olusturuldu);

create table public.hata_defteri (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid not null references public.ogrenciler(id),
  tarih date default current_date,
  ders text,
  konu text,
  zorluk text,
  fotograf_url text,                     -- özel depodaki yol; istemciye imzalı URL verilir
  ai_aciklama text,
  tekrar_sayisi integer default 1,
  cozuldu boolean not null default false,
  olusturuldu timestamptz default now()
);
create index hata_defteri_ogrenci_idx on public.hata_defteri(ogrenci_id, olusturuldu);

create table public.haftalik_raporlar (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid references public.ogrenciler(id),
  hafta_baslangic date,
  hafta_bitis date,
  toplam_saat numeric,
  toplam_soru integer,
  ozet_json jsonb,
  ai_analizi text,
  gonderildi_mi boolean default false,
  olusturuldu timestamptz default now()
);

create table public.calisma_takvimi (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid references public.ogrenciler(id) on delete cascade,
  hafta_baslangic date not null,
  gun_index integer not null,
  ders text not null,
  konu text default '',
  hedef_saat numeric default 0,
  tamamlandi boolean default false,
  created_at timestamptz default now()
);

create table public.pomodoro_oturumlari (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid not null references public.ogrenciler(id),
  ders text,
  tarih date default current_date,
  baslangic timestamptz not null,
  bitis timestamptz,
  sure_dakika integer,
  odaklanma_skoru integer,
  olusturuldu timestamptz default now()
);

create table public.mesajlar (                -- veliden öğrenciye motivasyon mesajları
  id serial primary key,
  ogrenci_id uuid references public.ogrenciler(id) on delete cascade,
  gonderen text default 'veli',
  mesaj text not null,
  okundu boolean default false,
  olusturuldu timestamp default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  ogrenci_id uuid unique references public.ogrenciler(id) on delete cascade,
  subscription jsonb not null,
  olusturuldu timestamp default now()
);

-- ============================================================
-- Referans verisi
-- ============================================================

create table public.ders_konular (            -- 308 TYT/AYT konusu
  id serial primary key,
  sinav_turu text check (sinav_turu in ('TYT', 'AYT')),
  ders text not null,
  konu text not null,
  created_at timestamp default now()
);

create table public.exam_dates (              -- cron + AI web araması ile güncellenir
  exam_key text primary key,                  -- tyt_2027, ayt_2027
  exam_name text,
  exam_date date,
  exam_time time,
  tahmini boolean default false,
  updated_at timestamp default now()
);

create table public.yokatlas_programlar (     -- Python servisiyle yıllık güncellenir (~20.900 program / yıl)
  id bigserial primary key,
  kilavuz_kodu bigint not null,
  yil integer not null,
  universite_id integer,
  universite_adi text not null,
  universite_turu text not null,
  fakulte_adi text,
  program_adi text not null,
  puan_turu text not null,
  il_adi text,
  ogrenim_turu text,
  ogrenim_suresi integer,
  burs_turu text,
  kontenjan integer,
  yerlesen integer,
  min_puan numeric,
  basari_sirasi integer,
  gecmis_yillar jsonb default '[]',
  guncelleme_tarihi timestamptz default now(),
  unique (kilavuz_kodu, yil)
);

-- ============================================================
-- Premium
-- ============================================================

create table public.abonelikler (
  ogrenci_id uuid primary key references public.ogrenciler(id) on delete cascade,
  deneme_bitis timestamptz,                   -- yeni kayıtta now() + 7 gün
  premium_bitis timestamptz,
  olusturuldu timestamptz not null default now(),
  guncellendi timestamptz not null default now()
);

-- ============================================================
-- Fonksiyonlar ve trigger'lar
-- ============================================================

-- Oturumdaki kullanıcının öğrenci kaydı (RLS politikalarında kullanılır)
create or replace function public.oturum_ogrenci_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.ogrenciler where auth_id = auth.uid() limit 1
$$;

-- Supabase Auth kaydı → öğrenci profili
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.raw_user_meta_data ? 'ad')
     and not exists (select 1 from public.ogrenciler where auth_id = new.id) then
    insert into public.ogrenciler (auth_id, email, ad, soyad, dogum_tarihi, veli_email)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data->>'ad', ''),
      coalesce(new.raw_user_meta_data->>'soyad', ''),
      nullif(new.raw_user_meta_data->>'dogum_tarihi', '')::date,
      nullif(new.raw_user_meta_data->>'veli_email', '')
    );
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Yeni öğrenciye 7 gün Premium deneme
create or replace function public.yeni_ogrenci_deneme_ver()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.abonelikler (ogrenci_id, deneme_bitis)
  values (new.id, now() + interval '7 days')
  on conflict (ogrenci_id) do nothing;
  return new;
end $$;
create trigger ogrenci_deneme_ver after insert on public.ogrenciler
  for each row execute function public.yeni_ogrenci_deneme_ver();

create or replace function public.premium_mi(p_ogrenci_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.abonelikler
    where ogrenci_id = p_ogrenci_id
      and (coalesce(premium_bitis, '-infinity') > now() or coalesce(deneme_bitis, '-infinity') > now())
  )
$$;

-- Ücretsiz plan limitleri veritabanında uygulanır (istemciden aşılamaz)
create or replace function public.premium_limit_kontrol()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ay_basi timestamptz := date_trunc('month', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
  v_sayi integer; v_limit integer; v_tur text;
begin
  if public.premium_mi(new.ogrenci_id) then return new; end if;

  if tg_table_name = 'deneme_sonuclari' then
    v_limit := 4; v_tur := 'deneme';
    select count(*) into v_sayi from public.deneme_sonuclari
      where ogrenci_id = new.ogrenci_id and olusturuldu >= v_ay_basi;
  else
    v_limit := 20; v_tur := 'hata';
    select count(*) into v_sayi from public.hata_defteri
      where ogrenci_id = new.ogrenci_id and olusturuldu >= v_ay_basi;
  end if;

  if v_sayi >= v_limit then
    raise exception 'PREMIUM_LIMIT:%', v_tur;
  end if;
  return new;
end $$;
create trigger deneme_limit before insert on public.deneme_sonuclari
  for each row execute function public.premium_limit_kontrol();
create trigger hata_limit before insert on public.hata_defteri
  for each row execute function public.premium_limit_kontrol();

-- İç fonksiyonlar istemci rollerinden kapatılır
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.yeni_ogrenci_deneme_ver() from public, anon, authenticated;
revoke execute on function public.premium_mi(uuid) from public, anon, authenticated;
revoke execute on function public.premium_limit_kontrol() from public, anon, authenticated;

-- ============================================================
-- Row Level Security
-- Öğrenci yalnızca kendi verisine erişir. Veli paneli ve ödeme akışı
-- sunucu tarafındaki route handler'lardan (service role) geçer.
-- ============================================================

alter table public.ogrenciler          enable row level security;
alter table public.veliler             enable row level security;
alter table public.veli_davetler       enable row level security;
alter table public.gunluk_kayitlar     enable row level security;
alter table public.deneme_sonuclari    enable row level security;
alter table public.hata_defteri        enable row level security;
alter table public.haftalik_raporlar   enable row level security;
alter table public.calisma_takvimi     enable row level security;
alter table public.pomodoro_oturumlari enable row level security;
alter table public.mesajlar            enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.abonelikler         enable row level security;
alter table public.ders_konular        enable row level security;
alter table public.exam_dates          enable row level security;
alter table public.yokatlas_programlar enable row level security;

create policy ogrenciler_select on public.ogrenciler for select to authenticated
  using (auth_id = (select auth.uid()));
create policy ogrenciler_update on public.ogrenciler for update to authenticated
  using (auth_id = (select auth.uid())) with check (auth_id = (select auth.uid()));
-- Öğrenci sadece profil ve hedef alanlarını değiştirebilir
revoke update on public.ogrenciler from anon, authenticated;
grant update (ad, soyad, hedef_universite, hedef_bolum, haftalik_hedef_soru, haftalik_hedef_saat)
  on public.ogrenciler to authenticated;

create policy gunluk_kendi on public.gunluk_kayitlar for all to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()))
  with check (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy deneme_kendi on public.deneme_sonuclari for all to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()))
  with check (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy hata_defteri_kendi on public.hata_defteri for all to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()))
  with check (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy takvim_kendi on public.calisma_takvimi for all to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()))
  with check (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy haftalik_rapor_kendi_okur on public.haftalik_raporlar for select to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy pomodoro_kendi_okur on public.pomodoro_oturumlari for select to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy pomodoro_kendi_ekler on public.pomodoro_oturumlari for insert to authenticated
  with check (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy mesajlar_kendi_okur on public.mesajlar for select to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy mesajlar_kendi_gunceller on public.mesajlar for update to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy veli_davet_kendi_okur on public.veli_davetler for select to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()));
create policy abonelik_kendi_okur on public.abonelikler for select to authenticated
  using (ogrenci_id = (select public.oturum_ogrenci_id()));

-- veliler, push_subscriptions: politika yok → yalnızca service role

-- Herkese açık referans verisi
create policy herkes_okur on public.ders_konular for select using (true);
create policy herkes_okur on public.exam_dates for select using (true);
create policy herkes_okur on public.yokatlas_programlar for select using (true);

-- ============================================================
-- Depolama: hata defteri fotoğrafları (özel bucket, klasör = öğrenci id)
-- ============================================================

create policy hata_foto_kendi_okur on storage.objects for select to authenticated
  using (bucket_id = 'hata-fotograflari' and (storage.foldername(name))[1] = (select public.oturum_ogrenci_id())::text);
create policy hata_foto_kendi_yukler on storage.objects for insert to authenticated
  with check (bucket_id = 'hata-fotograflari' and (storage.foldername(name))[1] = (select public.oturum_ogrenci_id())::text);
create policy hata_foto_kendi_siler on storage.objects for delete to authenticated
  using (bucket_id = 'hata-fotograflari' and (storage.foldername(name))[1] = (select public.oturum_ogrenci_id())::text);
