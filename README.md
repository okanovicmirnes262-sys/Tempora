# Smjene

Mobilna web aplikacija (PWA) za raspored smjena u kafićima. Ime aplikacije mijenjaš na jednom mjestu: `lib/config.ts`.

- **Vlasnik** slaže raspored (tjedan/mjesec), dobiva upozorenja prema Zakonu o radu, objavljuje, odobrava zamjene i izvozi Excel za knjigovođu.
- **Radnik** otvara osobni link `/r/<token>` (bez lozinke), vidi svoje smjene, upisuje kad ne može i nudi zamjene.

Tehnologija: Next.js 16 (Vercel) + Supabase (Postgres, Auth, RLS) + Web Push.

## Struktura

| Mjesto | Što je |
|---|---|
| `supabase/migrations/` | Shema baze, RLS, funkcije, pravila rada za HR |
| `supabase/seed.sql` | Testni podaci (Barone, Arsen, 6 radnika) |
| `supabase/tests/` | Testovi baze i RLS-a (lokalni Postgres) |
| `lib/rules/` | Pravila i upozorenja, blagdani, obračun sati + unit testovi |
| `app/(vlasnik)/` | Raspored, Radnici, Zamjene, Postavke |
| `app/r/[token]/` | Ekran radnika |
| `app/api/` | Objava, zamjene, push, Excel izvoz |
| `public/sw.js` | Service worker (push) |

## Postavljanje (korak po korak)

### 1. Supabase
1. Napravi projekt na [supabase.com](https://supabase.com) (regija **Frankfurt / eu-central-1**).
2. **SQL Editor → New query**: zalijepi i pokreni redom
   1. `supabase/migrations/20261024000000_init.sql`
   2. `supabase/migrations/20261024000100_labor_rules_hr.sql`
   3. `supabase/seed.sql` — **prije pokretanja zamijeni `tvoj@email.com` svojim emailom**.
3. **Authentication → URL Configuration**
   - Site URL: `https://<tvoja-domena>.vercel.app`
   - Redirect URLs: dodaj `https://<tvoja-domena>.vercel.app/auth/callback` (i `http://localhost:3000/auth/callback` za lokalni rad).
4. **Authentication → Emails → Magic Link**: u predložak dodaj kod, npr.
   `<p>Kod za prijavu: <b>{{ .Token }}</b></p>` — tako se možeš prijaviti i iz aplikacije na početnom zaslonu.
5. **Project Settings → API**: kopiraj *Project URL*, *anon/publishable* ključ i *service_role/secret* ključ.

### 2. Ključevi za push obavijesti
```bash
npm install
npm run vapid
```
Dobiješ *Public Key* i *Private Key*.

### 3. Vercel
1. [vercel.com](https://vercel.com) → **Add New → Project** → odaberi ovaj GitHub repozitorij.
2. **Environment Variables** (vidi `.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:tvoj@email.com`).
3. **Deploy**. Domenu zatim upiši u Supabase (korak 1.3).

## Lokalni razvoj
```bash
cp .env.example .env.local   # upiši ključeve
npm run dev                  # http://localhost:3000
npm test                     # unit testovi pravila (21 test)
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh   # testovi baze/RLS na praznom lokalnom Postgresu
```

## Sigurnost
- Svaka tablica ima `org_id` i RLS: vlasnik vidi samo svoju organizaciju.
- Radnici nemaju izravan pristup tablicama; sve ide kroz `w_*` funkcije koje provjeravaju token (256 bita, nasumičan). Vlasnik ga može ponovno generirati — stari link odmah prestaje raditi.
- Radnik vidi samo svoj raspored, imena kolega (bez brojeva) i ponude zamjene namijenjene njemu.

> Aplikacija upozorava, a odgovornost za poštivanje Zakona o radu je na poslodavcu.
