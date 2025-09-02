// app/admin/page.tsx
// TMTF İstanbul Yetkilisi için yönetim paneli (turnuva/roster/maç/sıralama/medya ekleme)
// Yazma işlemleri: Server Actions + SUPABASE_SERVICE_ROLE_KEY (yalnızca server)

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

// SSR + Server Actions için
export const revalidate = 0;

// ---- Supabase Admin (server-only) ----
const supaAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // sadece server
  { auth: { persistSession: false } }
);

// ---- Tipler ----
type Tournament = {
  id: string;
  name: string;
  year: number | null;
  city: string | null;
  venue: string | null;
  type: "resmi" | "ozel";
  status: "draft" | "published" | "completed";
  starts_at: string | null;
  ends_at: string | null;
};

type Roster = {
  id: string;
  tournament_id: string;
  first_name: string;
  last_name: string;
  club: string | null;
  gender: "F" | "M" | null;
};

type MatchRow = {
  id: string;
  tournament_id: string;
  gender: "F" | "M" | null;
  round: string | null;
  player_a_roster_id: string;
  player_b_roster_id: string;
  score_summary: string | null;
  sets: string | null;
  table_no: string | null;
  started_at: string | null;
};

type RankingRow = {
  id: string;
  tournament_id: string;
  gender: "F" | "M" | null;
  event: string | null;
  position: number;
  athlete_display: string;
  club: string | null;
};

type MediaRow = {
  id: string;
  tournament_id: string;
  type: "image" | "video";
  caption: string | null;
  credit: string | null;
  url: string;
  is_cover: boolean | null;
  gender: "F" | "M" | null;
  event: string | null;
  created_at: string | null;
};

// ---- Yardımcılar ----
function assertAdminToken(formData: FormData) {
  const token = String(formData.get("admin_token") || "");
  const expected = process.env.ADMIN_ACCESS_TOKEN || "";
  if (!expected) {
    throw new Error("ADMIN_ACCESS_TOKEN .env.local içine eklenmemiş.");
  }
  if (token !== expected) {
    throw new Error("Yetkisiz işlem. ADMIN_ACCESS_TOKEN hatalı.");
  }
}

function toStr(v: unknown) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
}
function toNum(v: unknown) {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- Server Actions ----
async function createTournamentAction(formData: FormData) {
  "use server";
  assertAdminToken(formData);

  const name = toStr(formData.get("name"));
  if (!name) throw new Error("Turnuva adı zorunlu");
  const year = toNum(formData.get("year"));
  const city = toStr(formData.get("city"));
  const venue = toStr(formData.get("venue"));
  const type = (toStr(formData.get("type")) as "resmi" | "ozel") ?? "ozel";
  const status =
    (toStr(formData.get("status")) as "draft" | "published" | "completed") ??
    "draft";
  const starts_at = toStr(formData.get("starts_at"));
  const ends_at = toStr(formData.get("ends_at"));

  const { data, error } = await supaAdmin
    .from("tournaments")
    .insert({
      name,
      year,
      city,
      venue,
      type,
      status,
      starts_at,
      ends_at,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  redirect(`/admin?tid=${data!.id}`);
}

async function addRosterAction(formData: FormData) {
  "use server";
  assertAdminToken(formData);

  const tournament_id = toStr(formData.get("tournament_id"));
  if (!tournament_id) throw new Error("tournament_id zorunlu");

  const first_name = toStr(formData.get("first_name"));
  const last_name = toStr(formData.get("last_name"));
  if (!first_name || !last_name) throw new Error("Ad ve Soyad zorunlu");

  const club = toStr(formData.get("club"));
  const gender = (toStr(formData.get("gender")) as "F" | "M" | null) ?? null;

  const { error } = await supaAdmin.from("tournament_roster").insert({
    tournament_id,
    first_name,
    last_name,
    club,
    gender,
  });
  if (error) throw new Error(error.message);
}

async function addMatchAction(formData: FormData) {
  "use server";
  assertAdminToken(formData);

  const tournament_id = toStr(formData.get("tournament_id"));
  if (!tournament_id) throw new Error("tournament_id zorunlu");

  const player_a_roster_id = toStr(formData.get("player_a_roster_id"));
  const player_b_roster_id = toStr(formData.get("player_b_roster_id"));
  if (!player_a_roster_id || !player_b_roster_id)
    throw new Error("A ve B oyuncu id zorunlu");

  const gender = (toStr(formData.get("gender")) as "F" | "M" | null) ?? null;
  const round = toStr(formData.get("round"));
  const score_summary = toStr(formData.get("score_summary"));
  const sets = toStr(formData.get("sets"));
  const table_no = toStr(formData.get("table_no"));
  const started_at = toStr(formData.get("started_at"));

  const { error } = await supaAdmin.from("matches").insert({
    tournament_id,
    player_a_roster_id,
    player_b_roster_id,
    gender,
    round,
    score_summary,
    sets,
    table_no,
    started_at,
  });
  if (error) throw new Error(error.message);
}

async function addRankingAction(formData: FormData) {
  "use server";
  assertAdminToken(formData);

  const tournament_id = toStr(formData.get("tournament_id"));
  if (!tournament_id) throw new Error("tournament_id zorunlu");

  const position = Number(formData.get("position"));
  if (!Number.isFinite(position) || position < 1)
    throw new Error("Geçerli bir sıra (1+) girin");

  const athlete_display = toStr(formData.get("athlete_display"));
  if (!athlete_display) throw new Error("Sporcu adı zorunlu");

  const gender = (toStr(formData.get("gender")) as "F" | "M" | null) ?? null;
  const event = toStr(formData.get("event"));
  const club = toStr(formData.get("club"));

  const { error } = await supaAdmin.from("ranking").insert({
    tournament_id,
    position,
    athlete_display,
    gender,
    event,
    club,
  });
  if (error) throw new Error(error.message);
}

async function addMediaAction(formData: FormData) {
  "use server";
  assertAdminToken(formData);

  const tournament_id = toStr(formData.get("tournament_id"));
  if (!tournament_id) throw new Error("tournament_id zorunlu");

  const type = (toStr(formData.get("type")) as "image" | "video") || "image";
  const url = toStr(formData.get("url"));
  if (!url) throw new Error("URL zorunlu");

  const caption = toStr(formData.get("caption"));
  const credit = toStr(formData.get("credit"));
  const is_cover = String(formData.get("is_cover") || "") === "on";
  const gender = (toStr(formData.get("gender")) as "F" | "M" | null) ?? null;
  const event = toStr(formData.get("event"));

  const { error } = await supaAdmin.from("media").insert({
    tournament_id,
    type,
    url,
    caption,
    credit,
    is_cover,
    gender,
    event,
  });
  if (error) throw new Error(error.message);
}

// ---- Sayfa ----
export default async function AdminPage({
  searchParams,
}: {
  searchParams: { tid?: string };
}) {
  const tid = searchParams.tid || null;

  // Son 5 turnuva
  const { data: lastTournaments } = await supaAdmin
    .from("tournaments")
    .select("id,name,year,city,status")
    .order("created_at", { ascending: false })
    .limit(5);

  // Yönetilecek veriler (varsa)
  let tournament: Tournament | null = null;
  let roster: Roster[] = [];
  let matches: MatchRow[] = [];
  let ranking: RankingRow[] = [];
  let media: MediaRow[] = [];

  if (tid) {
    const { data: t } = await supaAdmin
      .from("tournaments")
      .select("*")
      .eq("id", tid)
      .single();
    tournament = t ?? null;

    const [{ data: r1 }, { data: r2 }, { data: r3 }, { data: r4 }] =
      await Promise.all([
        supaAdmin
          .from("tournament_roster")
          .select("*")
          .eq("tournament_id", tid)
          .order("created_at", { ascending: true })
          .limit(200),
        supaAdmin
          .from("matches")
          .select("*")
          .eq("tournament_id", tid)
          .order("started_at", { ascending: false, nullsFirst: false })
          .limit(200),
        supaAdmin
          .from("ranking")
          .select("*")
          .eq("tournament_id", tid)
          .order("position", { ascending: true })
          .limit(200),
        supaAdmin
          .from("media")
          .select("*")
          .eq("tournament_id", tid)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
    roster = (r1 ?? []) as Roster[];
    matches = (r2 ?? []) as MatchRow[];
    ranking = (r3 ?? []) as RankingRow[];
    media = (r4 ?? []) as MediaRow[];
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <h1 className="text-2xl font-semibold">Yönetim – TMTF İstanbul</h1>

      {/* Son turnuvalar */}
      <section className="rounded-lg border p-3">
        <div className="text-sm font-medium">Son Turnuvalar</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(lastTournaments ?? []).map((t) => (
            <a
              key={t.id}
              className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
              href={`/admin?tid=${t.id}`}
              title={`${t.name} ${t.year ?? ""}`}
            >
              {t.name} {t.year ? `(${t.year})` : ""} · {t.city ?? "—"} · {t.status}
            </a>
          ))}
        </div>
      </section>

      {/* Turnuva oluştur */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">1) Turnuva Oluştur</h2>
        <form action={createTournamentAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm" required />
          <input name="name" placeholder="Ad (zorunlu)" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="year" type="number" placeholder="Yıl (örn 2025)" className="rounded-md border px-3 py-2 text-sm" />
          <input name="city" placeholder="Şehir" className="rounded-md border px-3 py-2 text-sm" />
          <input name="venue" placeholder="Salon/Adres" className="rounded-md border px-3 py-2 text-sm" />
          <select name="type" className="rounded-md border px-3 py-2 text-sm">
            <option value="resmi">Resmî</option>
            <option value="ozel">Özel</option>
          </select>
          <select name="status" className="rounded-md border px-3 py-2 text-sm">
            <option value="draft">Taslak</option>
            <option value="published">Yayında</option>
            <option value="completed">Tamamlandı</option>
          </select>
          <input name="starts_at" type="datetime-local" className="rounded-md border px-3 py-2 text-sm" />
          <input name="ends_at" type="datetime-local" className="rounded-md border px-3 py-2 text-sm" />
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-3">Oluştur</button>
        </form>
        <p className="mt-2 text-xs text-gray-600">
          Başarılı olursa sayfa <b>?tid=&lt;yeni-id&gt;</b> ile yeniden yüklenir.
        </p>
      </section>

      {/* Yönetilecek turnuva */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">2) Turnuvayı Yönet</h2>
        <form method="get" className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            name="tid"
            defaultValue={tid ?? ""}
            placeholder="Turnuva ID"
            className="w-[360px] rounded-md border px-3 py-2 text-sm"
          />
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">Yükle</button>
          {tid && (
            <a
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
              href={`/tournaments/${tid}`}
              target="_blank"
            >
              Detay sayfasını aç ↗
            </a>
          )}
        </form>

        {tournament ? (
          <div className="mt-3 text-sm text-gray-700">
            <div>
              <b>{tournament.name}</b> {tournament.year ? `– ${tournament.year}` : ""} ·{" "}
              {tournament.city ?? "—"} · {tournament.type}/{tournament.status}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-gray-500">Yukarıya bir Turnuva ID gir veya yeni turnuva oluştur.</div>
        )}
      </section>

      {/* Katılımcı Ekle */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">3) Katılımcı Ekle</h2>
        <form action={addRosterAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-6">
          <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="tournament_id" placeholder="Turnuva ID" defaultValue={tid ?? ""} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <select name="gender" className="rounded-md border px-3 py-2 text-sm">
            <option value="">Cinsiyet —</option>
            <option value="M">Erkek</option>
            <option value="F">Kadın</option>
          </select>
          <input name="club" placeholder="Kulüp" className="rounded-md border px-3 py-2 text-sm" />
          <input name="first_name" placeholder="Ad" className="rounded-md border px-3 py-2 text-sm" required />
          <input name="last_name" placeholder="Soyad" className="rounded-md border px-3 py-2 text-sm" required />
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">Ekle</button>
        </form>

        {roster.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Ad Soyad</th>
                  <th className="px-3 py-2 text-left">Kulüp</th>
                  <th className="px-3 py-2 text-left">Cinsiyet</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-3 py-2">{r.id}</td>
                    <td className="px-3 py-2">{r.first_name} {r.last_name}</td>
                    <td className="px-3 py-2">{r.club ?? "—"}</td>
                    <td className="px-3 py-2">{r.gender ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Maç Ekle */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">4) Maç Sonucu Ekle</h2>
        <form action={addMatchAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-6">
          <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="tournament_id" placeholder="Turnuva ID" defaultValue={tid ?? ""} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <select name="gender" className="rounded-md border px-3 py-2 text-sm">
            <option value="">Cinsiyet —</option>
            <option value="M">Erkek</option>
            <option value="F">Kadın</option>
          </select>
          <select name="round" className="rounded-md border px-3 py-2 text-sm">
            <option value="">Tur —</option>
            <option value="group">Grup</option>
            <option value="r32">Son 32</option>
            <option value="r16">Son 16</option>
            <option value="qf">Çeyrek</option>
            <option value="sf">Yarı Final</option>
            <option value="f">Final</option>
          </select>
          <input name="player_a_roster_id" placeholder="A Oyuncu Roster ID" className="rounded-md border px-3 py-2 text-sm md:col-span-3" required />
          <input name="player_b_roster_id" placeholder="B Oyuncu Roster ID" className="rounded-md border px-3 py-2 text-sm md:col-span-3" required />
          <input name="score_summary" placeholder="Skor (örn 3-2)" className="rounded-md border px-3 py-2 text-sm" />
          <input name="sets" placeholder="Setler (örn 11-8,9-11,11-9,8-11,11-7)" className="rounded-md border px-3 py-2 text-sm md:col-span-3" />
          <input name="table_no" placeholder="Masa no (örn 2)" className="rounded-md border px-3 py-2 text-sm" />
          <input name="started_at" type="datetime-local" className="rounded-md border px-3 py-2 text-sm" />
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">Ekle</button>
        </form>

        {roster.length > 0 && (
          <div className="mt-4 text-xs text-gray-600">
            <div className="font-medium">Roster ID’leri (kopyala-yapıştır için):</div>
            <ul className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {roster.map((r) => (
                <li key={r.id}>
                  <code>{r.id}</code> – {r.first_name} {r.last_name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Sıralama Ekle */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">5) Sıralama Ekle</h2>
        <form action={addRankingAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-6">
          <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="tournament_id" placeholder="Turnuva ID" defaultValue={tid ?? ""} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="position" type="number" min={1} placeholder="Sıra (1+)" className="rounded-md border px-3 py-2 text-sm" required />
          <input name="athlete_display" placeholder="Sporcu adı (Ad Soyad veya 'Ad1 / Ad2')" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="club" placeholder="Kulüp" className="rounded-md border px-3 py-2 text-sm" />
          <select name="gender" className="rounded-md border px-3 py-2 text-sm">
            <option value="">Cinsiyet —</option>
            <option value="M">Erkek</option>
            <option value="F">Kadın</option>
          </select>
          <input name="event" placeholder="Etkinlik (örn Açık Tekler)" className="rounded-md border px-3 py-2 text-sm md:col-span-3" />
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">Ekle</button>
        </form>
      </section>

      {/* Medya Ekle */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">6) Medya Ekle</h2>
        <form action={addMediaAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-6">
          <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <input name="tournament_id" placeholder="Turnuva ID" defaultValue={tid ?? ""} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
          <select name="type" className="rounded-md border px-3 py-2 text-sm">
            <option value="image">Görsel</option>
            <option value="video">Video</option>
          </select>
          <input name="url" placeholder="Medya URL" className="rounded-md border px-3 py-2 text-sm md:col-span-3" required />
          <input name="caption" placeholder="Açıklama" className="rounded-md border px-3 py-2 text-sm md:col-span-3" />
          <input name="credit" placeholder="Kredi (Foto: ...)" className="rounded-md border px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input name="is_cover" type="checkbox" /> Kapak
          </label>
          <select name="gender" className="rounded-md border px-3 py-2 text-sm">
            <option value="">Cinsiyet —</option>
            <option value="M">Erkek</option>
            <option value="F">Kadın</option>
          </select>
          <input name="event" placeholder="Etkinlik" className="rounded-md border px-3 py-2 text-sm" />
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">Ekle</button>
        </form>
      </section>

      {/* İpuçları */}
      <section className="rounded-lg border p-4 text-sm text-gray-700">
        <div className="font-medium mb-2">İpuçları</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Önce turnuvayı oluştur, ID otomatik URL’ye gelir. Sonra katılımcı → maç → sıralama → medya ekle.</li>
          <li>Maç eklerken her iki oyuncunun roster ID’si aynı turnuvaya ait olmalı (DB tetikleyicisi bu kuralı zorlar).</li>
          <li>Verileri anında görmek için detay sayfasını yeni sekmede açıp yenile.</li>
        </ul>
      </section>
    </main>
  );
}
