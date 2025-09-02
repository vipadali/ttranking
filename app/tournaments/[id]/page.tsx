// app/tournaments/[id]/page.tsx
// Next.js App Router (14/15), TypeScript, SSR Server Component
// Tek dosya - çalışır örnek. Supabase'den turnuva detayını ve sekmeleri çeker.

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

// (Opsiyonel) ISR
export const revalidate = 60;

// --------------------------------------------------
// Supabase client (server-side, anon key ile read-only)
// --------------------------------------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

// --------------------------------------------------
// DB tipleri (şemanla birebir)
// --------------------------------------------------
type Tournament = {
  id: string;
  slug: string | null;
  name: string;
  year: number | null;
  city: string | null;
  venue: string | null;
  type: "resmi" | "ozel";
  status: "draft" | "published" | "completed";
  starts_at: string | null;
  ends_at: string | null;
  poster_url: string | null;
  owner_org_id: string | null;
};

type RosterEntry = {
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

// --------------------------------------------------
// (Geçici) Rol modeli — headers() tamamen kaldırıldı
// --------------------------------------------------
type Role = "PUBLIC";
const role: Role = "PUBLIC";

// --------------------------------------------------
// Yardımcılar
// --------------------------------------------------
function fmtRange(starts?: string | null, ends?: string | null) {
  const toTR = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString("tr-TR") : "";
  const a = toTR(starts);
  const b = toTR(ends);
  if (!a && !b) return "";
  if (a && !b) return a;
  if (!a && b) return b;
  return `${a} – ${b}`;
}

function typeBadge(t: Tournament["type"]) {
  return t === "resmi" ? "Resmî" : "Özel";
}

function statusBadge(s: Tournament["status"]) {
  if (s === "draft") return "Taslak";
  if (s === "published") return "Yayında";
  return "Tamamlandı";
}

function fullname(r: Pick<RosterEntry, "first_name" | "last_name">) {
  return `${r.first_name} ${r.last_name}`;
}

// --------------------------------------------------
// Metadata (SEO/OG)
// --------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  let title = "Turnuva Detayı";
  let description =
    "Turnuva bilgileri, katılımcılar, maçlar, sıralama ve medya.";
  try {
    const { data } = await supabase
      .from("tournaments")
      .select("name,year,city,starts_at,ends_at,poster_url")
      .eq("id", params.id)
      .single();
    if (data) {
      title = `${data.name}${data.year ? " – " + data.year : ""} | Masa Tenisi`;
      const dr = fmtRange(data.starts_at, data.ends_at);
      description = `${data.city ?? ""}${dr ? `, ${dr}` : ""} – Katılımcılar, maçlar, ilk 4 ve medya.`;
    }
  } catch {}
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

// --------------------------------------------------
// Sayfa (SSR)
// --------------------------------------------------
export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const currentTab = (searchParams.tab || "participants") as
    | "participants"
    | "matches"
    | "ranking"
    | "media";

  const uiErrors: string[] = [];

  // 1) Turnuva
  let tournament: Tournament | null = null;
  try {
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .eq("id", params.id)
      .single();
    if (error) throw error;
    tournament = data!;
  } catch (err: any) {
    uiErrors.push(
      `Turnuva yüklenirken bir hata oluştu: ${err?.message ?? "Bilinmeyen hata"}`
    );
  }

  if (!tournament) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Turnuva bulunamadı</h1>
        <p className="mt-2 text-gray-600">
          Aradığınız turnuva mevcut değil veya kaldırılmış olabilir.
        </p>
        <div className="mt-6">
          <Link
            href="/tournaments"
            className="inline-block rounded-lg border px-4 py-2 hover:bg-gray-50"
          >
            Turnuvalara dön
          </Link>
        </div>
      </main>
    );
  }

  // 2) Sekme verileri (özetler)
  let participants: RosterEntry[] = [];
  let lastMatches: (MatchRow & { player_a?: RosterEntry; player_b?: RosterEntry })[] =
    [];
  let top4: RankingRow[] = [];
  let media6: MediaRow[] = [];

  // Katılımcılar (ilk 25)
  try {
    const { data, error } = await supabase
      .from("tournament_roster")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("created_at", { ascending: true })
      .limit(25);
    if (error) throw error;
    participants = data ?? [];
  } catch (err: any) {
    uiErrors.push(
      `Katılımcılar yüklenemedi: ${err?.message ?? "Bilinmeyen hata"}`
    );
  }

  // Maçlar (son 10) + roster bilgisi
  try {
    const { data, error } = await supabase
      .from("matches")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(10);
    if (error) throw error;

    const rosterMap = new Map<string, RosterEntry>();
    if (data && data.length > 0) {
      const rosterIds = Array.from(
        new Set(
          data.flatMap((m) => [m.player_a_roster_id, m.player_b_roster_id])
        )
      );
      const { data: rosterList, error: rosterErr } = await supabase
        .from("tournament_roster")
        .select("*")
        .in("id", rosterIds);
      if (rosterErr) throw rosterErr;
      (rosterList ?? []).forEach((r: RosterEntry) => rosterMap.set(r.id, r));
    }

    lastMatches =
      (data ?? []).map(
        (m: MatchRow): MatchRow & { player_a?: RosterEntry; player_b?: RosterEntry } => ({
          ...m,
          player_a: rosterMap.get(m.player_a_roster_id),
          player_b: rosterMap.get(m.player_b_roster_id),
        })
      ) ?? [];
  } catch (err: any) {
    uiErrors.push(`Maçlar yüklenemedi: ${err?.message ?? "Bilinmeyen hata"}`);
  }

  // Sıralama (ilk 4)
  try {
    const { data, error } = await supabase
      .from("ranking")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("position", { ascending: true })
      .limit(4);
    if (error) throw error;
    top4 = data ?? [];
  } catch (err: any) {
    uiErrors.push(`Sıralama yüklenemedi: ${err?.message ?? "Bilinmeyen hata"}`);
  }

  // Medya (6)
  try {
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("tournament_id", tournament.id)
      .order("created_at", { ascending: false })
      .limit(6);
    if (error) throw error;
    media6 = data ?? [];
  } catch (err: any) {
    uiErrors.push(`Medya yüklenemedi: ${err?.message ?? "Bilinmeyen hata"}`);
  }

  // Organizer kısayolları (şimdilik rol PUBLIC olduğu için gizli)
  const organizerShortcutsVisible = false;

  const tabHref = (t: string) =>
    `/tournaments/${tournament!.id}?tab=${encodeURIComponent(t)}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Üst Özet */}
      <section className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {tournament.name} {tournament.year ? `– ${tournament.year}` : ""}
          </h1>
          <p className="mt-1 text-gray-700">
            {fmtRange(tournament.starts_at, tournament.ends_at)}
            {tournament.city ? ` · ${tournament.city}` : ""}
            {tournament.venue ? ` · ${tournament.venue}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border px-2 py-1 text-xs">
              {typeBadge(tournament.type)}
            </span>
            <span className="rounded-full border px-2 py-1 text-xs">
              {statusBadge(tournament.status)}
            </span>
          </div>
        </div>
        <div className="relative h-28 w-20 overflow-hidden rounded border md:h-40 md:w-28">
          {tournament.poster_url ? (
            <Image
              src={tournament.poster_url}
              alt="Turnuva Afişi"
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
              Afiş yok
            </div>
          )}
        </div>
      </section>

      {/* Rol-bazlı kısayollar (şimdilik gizli) */}
      {organizerShortcutsVisible && (
        <section className="mt-6 flex flex-wrap gap-2">
          <ActionButton href="#" label="Düzenle" />
          <ActionButton href="#" label="Etkinlik Ekle" />
          <ActionButton href="#" label="Katılımcı Ekle / CSV" />
          <ActionButton href="#" label="Maç Ekle / CSV" />
          <ActionButton href="#" label="Sıralama Güncelle" />
          <ActionButton href="#" label="Medya Yönet" />
        </section>
      )}

      {/* Hata Uyarıları (UI try/catch) */}
      {uiErrors.length > 0 && (
        <div className="mt-6 space-y-2">
          {uiErrors.map((e: string, i: number) => (
            <div
              key={i}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {e}
            </div>
          ))}
        </div>
      )}

      {/* Sekmeler */}
      <nav className="mt-8 flex gap-4 border-b">
        <TabLink href={tabHref("participants")} active={currentTab === "participants"}>
          Katılımcılar
        </TabLink>
        <TabLink href={tabHref("matches")} active={currentTab === "matches"}>
          Maçlar
        </TabLink>
        <TabLink href={tabHref("ranking")} active={currentTab === "ranking"}>
          Sıralama
        </TabLink>
        <TabLink href={tabHref("media")} active={currentTab === "media"}>
          Medya
        </TabLink>
      </nav>

      {/* Sekme İçerikleri */}
      <section className="mt-6">
        {currentTab === "participants" && (
          <ParticipantsTab participants={participants} />
        )}

        {currentTab === "matches" && (
          <MatchesTab matches={lastMatches} tournamentId={tournament.id} />
        )}

        {currentTab === "ranking" && (
          <RankingTab top4={top4} tournamentId={tournament.id} />
        )}

        {currentTab === "media" && (
          <MediaTab media6={media6} tournamentId={tournament.id} />
        )}
      </section>
    </main>
  );
}

// --------------------------------------------------
// Alt Bileşenler
// --------------------------------------------------
function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
    >
      {label}
    </Link>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-2 py-2 text-sm ${
        active ? "border-black font-medium" : "border-transparent text-gray-600 hover:text-black"
      }`}
    >
      {children}
    </Link>
  );
}

function ParticipantsTab({ participants }: { participants: RosterEntry[] }) {
  if (!participants || participants.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-gray-700">
        Henüz katılımcı eklenmemiş.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Ad Soyad</th>
            <th className="px-3 py-2 text-left font-medium">Kulüp</th>
            <th className="px-3 py-2 text-left font-medium">Cinsiyet</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((p: RosterEntry) => (
            <tr key={p.id} className="border-b">
              <td className="px-3 py-2">{fullname(p)}</td>
              <td className="px-3 py-2">{p.club ?? "—"}</td>
              <td className="px-3 py-2">{p.gender ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchesTab({
  matches,
  tournamentId,
}: {
  matches: (MatchRow & { player_a?: RosterEntry; player_b?: RosterEntry })[];
  tournamentId: string;
}) {
  return (
    <div className="space-y-4">
      {(!matches || matches.length === 0) && (
        <div className="rounded-lg border p-4 text-sm text-gray-700">
          Henüz maç girilmemiş.
        </div>
      )}

      {matches.map(
        (m: MatchRow & { player_a?: RosterEntry; player_b?: RosterEntry }) => (
          <div key={m.id} className="rounded-lg border p-3">
            <div className="text-sm">
              <span className="font-medium">
                {m.player_a ? fullname(m.player_a) : "?"}
              </span>{" "}
              vs{" "}
              <span className="font-medium">
                {m.player_b ? fullname(m.player_b) : "?"}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-600">
              {m.score_summary ?? "—"}{" "}
              {m.sets ? <span className="ml-2">({m.sets})</span> : null} ·{" "}
              {m.round?.toUpperCase() ?? "—"} · {m.table_no ?? "Masa —"} ·{" "}
              {m.started_at
                ? new Date(m.started_at).toLocaleString("tr-TR")
                : "—"}
            </div>
          </div>
        )
      )}

      <div className="pt-2">
        <Link
          href={`/tournaments/${tournamentId}/matches`}
          className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Tüm Maçları Gör
        </Link>
      </div>
    </div>
  );
}

function RankingTab({
  top4,
  tournamentId,
}: {
  top4: RankingRow[];
  tournamentId: string;
}) {
  if (!top4 || top4.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-gray-700">
        Sıralama henüz yayınlanmadı.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Sıra</th>
              <th className="px-3 py-2 text-left font-medium">Sporcu</th>
              <th className="px-3 py-2 text-left font-medium">Kulüp</th>
            </tr>
          </thead>
          <tbody>
            {top4.map((r: RankingRow) => (
              <tr key={r.id} className="border-b">
                <td className="px-3 py-2">{r.position}</td>
                <td className="px-3 py-2">{r.athlete_display}</td>
                <td className="px-3 py-2">{r.club ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link
        href={`/tournaments/${tournamentId}/ranking`}
        className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        Tüm Sıralamayı Gör
      </Link>
    </div>
  );
}

function MediaTab({
  media6,
  tournamentId,
}: {
  media6: MediaRow[];
  tournamentId: string;
}) {
  if (!media6 || media6.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-gray-700">
        Henüz medya eklenmedi.
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {media6.map((m: MediaRow) => (
          <a
            key={m.id}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="group relative block overflow-hidden rounded border"
          >
            <div className="aspect-[4/5] bg-gray-100" />
            <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/40 via-black/0 to-transparent p-2">
              <div className="text-xs text-white">
                {m.caption ?? (m.type === "video" ? "Video" : "Görsel")}
                {m.is_cover ? (
                  <span className="ml-1 rounded bg-white/80 px-1 text-[10px] text-black">
                    Kapak
                  </span>
                ) : null}
              </div>
            </div>
          </a>
        ))}
      </div>

      <div className="pt-3">
        <Link
          href={`/tournaments/${tournamentId}/media`}
          className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Tüm Medyayı Gör
        </Link>
      </div>
    </div>
  );
}
