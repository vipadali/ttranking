// app/tournaments/[id]/matches/page.tsx
// Tek dosya, SSR. Filtreler: q (isim), gender (F/M), round, sayfalama (page).
// Supabase'den matches + roster join ile isimleri getirir.

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

// (ops) ISR
export const revalidate = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

// DB tipleri
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
  round: string | null; // 'group'|'r32'|'r16'|'qf'|'sf'|'f'
  player_a_roster_id: string;
  player_b_roster_id: string;
  score_summary: string | null;
  sets: string | null;
  table_no: string | null;
  started_at: string | null;
};

function fullname(r?: RosterEntry) {
  return r ? `${r.first_name} ${r.last_name}` : "?";
}

function fmtDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString("tr-TR") : "—";
}

// URL query yardımcıları
function qs(current: Record<string, any>, patch: Record<string, any>) {
  const p = new URLSearchParams();
  const base: Record<string, any> = { ...current, ...patch };
  Object.keys(base).forEach((k) => {
    const v = base[k];
    if (v === undefined || v === null || v === "") return;
    p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    q?: string;
    gender?: "F" | "M";
    round?: string;
    page?: string;
  };
}) {
  const tournamentId = params.id;
  const q = (searchParams.q ?? "").trim();
  const gender = searchParams.gender === "F" || searchParams.gender === "M" ? searchParams.gender : undefined;
  const round = searchParams.round && ["group","r32","r16","qf","sf","f"].includes(searchParams.round) ? searchParams.round : undefined;

  const PAGE_SIZE = 20;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const uiErrors: string[] = [];

  // 1) İsim filtresi varsa, önce ilgili roster id'lerini bul
  let rosterFilterIds: string[] | null = null;
  if (q) {
    try {
      const { data: rosterList, error: rosterErr } = await supabase
        .from("tournament_roster")
        .select("id, first_name, last_name")
        .eq("tournament_id", tournamentId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,(first_name||' '||last_name).ilike.%${q}%`)
        .limit(500);
      if (rosterErr) throw rosterErr;
      rosterFilterIds = (rosterList ?? []).map((r) => r.id);
      if (rosterFilterIds.length === 0) {
        // İsim eşleşmesi yoksa, boş sonuç döneceğiz
        return renderPage({
          tournamentId,
          current: [],
          count: 0,
          page,
          pageSize: PAGE_SIZE,
          searchParams,
          uiErrors,
        });
      }
    } catch (err: any) {
      uiErrors.push(`İsim filtresi uygulanamadı: ${err?.message ?? "Bilinmeyen hata"}`);
    }
  }

  // 2) Matches sorgusu (sayfalı + toplam sayım)
  let matchRows: MatchRow[] = [];
  let totalCount = 0;

  try {
    let query = supabase
      .from("matches")
      .select("*", { count: "exact" })
      .eq("tournament_id", tournamentId);

    if (gender) query = query.eq("gender", gender);
    if (round) query = query.eq("round", round);

    if (rosterFilterIds && rosterFilterIds.length > 0) {
      // player_a veya player_b bu isimlerden biri olmalı
      const idList = rosterFilterIds.join(",");
      query = query.or(
        `player_a_roster_id.in.(${idList}),player_b_roster_id.in.(${idList})`
      );
    }

    query = query.order("started_at", { ascending: false, nullsFirst: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;
    matchRows = data ?? [];
    totalCount = count ?? 0;
  } catch (err: any) {
    uiErrors.push(`Maçlar yüklenirken hata: ${err?.message ?? "Bilinmeyen hata"}`);
  }

  // 3) Listedeki maçlar için isimleri map'lemek üzere roster önbelleği
  let rosterMap = new Map<string, RosterEntry>();
  try {
    const ids = Array.from(
      new Set(matchRows.flatMap((m) => [m.player_a_roster_id, m.player_b_roster_id]))
    );
    if (ids.length > 0) {
      const { data: roster, error } = await supabase
        .from("tournament_roster")
        .select("*")
        .in("id", ids);
      if (error) throw error;
      (roster ?? []).forEach((r) => rosterMap.set(r.id, r));
    }
  } catch (err: any) {
    uiErrors.push(`İsimler yüklenirken hata: ${err?.message ?? "Bilinmeyen hata"}`);
  }

  // 4) Render
  return renderPage({
    tournamentId,
    current: matchRows,
    rosterMap,
    count: totalCount,
    page,
    pageSize: PAGE_SIZE,
    searchParams,
    uiErrors,
  });
}

function renderPage({
  tournamentId,
  current,
  rosterMap = new Map<string, RosterEntry>(),
  count,
  page,
  pageSize,
  searchParams,
  uiErrors,
}: {
  tournamentId: string;
  current: MatchRow[];
  rosterMap?: Map<string, RosterEntry>;
  count: number;
  page: number;
  pageSize: number;
  searchParams: Record<string, any>;
  uiErrors: string[];
}) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const rounds = [
    { v: "", l: "Tüm turlar" },
    { v: "group", l: "Grup" },
    { v: "r32", l: "Son 32" },
    { v: "r16", l: "Son 16" },
    { v: "qf", l: "Çeyrek" },
    { v: "sf", l: "Yarı Final" },
    { v: "f", l: "Final" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-xl font-semibold">Maçlar</h1>

      {/* Filtre Formu (GET) */}
      <form method="get" className="mt-4 grid grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-6">
        <input
          type="text"
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="İsim ara (Ad/soyad)"
          className="col-span-2 rounded-md border px-3 py-2 text-sm outline-none"
        />
        <select
          name="gender"
          defaultValue={searchParams.gender ?? ""}
          className="rounded-md border px-3 py-2 text-sm outline-none"
        >
          <option value="">Tüm cinsiyetler</option>
          <option value="M">Erkek</option>
          <option value="F">Kadın</option>
        </select>
        <select
          name="round"
          defaultValue={searchParams.round ?? ""}
          className="rounded-md border px-3 py-2 text-sm outline-none"
        >
          {rounds.map((r) => (
            <option key={r.v} value={r.v}>
              {r.l}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          name="page"
          defaultValue={Number(searchParams.page ?? "1")}
          className="w-24 rounded-md border px-3 py-2 text-sm outline-none"
          title="Sayfa"
        />
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">
            Ara
          </button>
          <Link
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            href={`/tournaments/${tournamentId}/matches`}
          >
            Temizle
          </Link>
        </div>
      </form>

      {/* UI Hataları */}
      {uiErrors.length > 0 && (
        <div className="mt-4 space-y-2">
          {uiErrors.map((e, i) => (
            <div key={i} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {e}
            </div>
          ))}
        </div>
      )}

      {/* Liste */}
      <section className="mt-4 space-y-3">
        {current.length === 0 && (
          <div className="rounded-lg border p-4 text-sm text-gray-700">Kayıt bulunamadı.</div>
        )}

        {current.map((m) => {
          const a = rosterMap.get(m.player_a_roster_id);
          const b = rosterMap.get(m.player_b_roster_id);
          return (
            <div key={m.id} className="rounded-lg border p-3">
              <div className="text-sm">
                <span className="font-medium">{fullname(a)}</span> vs{" "}
                <span className="font-medium">{fullname(b)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {m.score_summary ?? "—"} {m.sets ? <span className="ml-2">({m.sets})</span> : null} ·{" "}
                {(m.round ?? "—").toUpperCase()} · {m.table_no ?? "Masa —"} · {fmtDate(m.started_at)}
              </div>
            </div>
          );
        })}
      </section>

      {/* Sayfalama */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <div>
          Toplam <b>{count}</b> maç · Sayfa <b>{page}</b>/<b>{totalPages}</b>
        </div>
        <div className="flex gap-2">
          {hasPrev ? (
            <Link
              className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
              href={qs(searchParams, { page: String(page - 1) })}
            >
              ‹ Önceki
            </Link>
          ) : (
            <span className="rounded-md border px-3 py-1.5 text-gray-400">‹ Önceki</span>
          )}
          {hasNext ? (
            <Link
              className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
              href={qs(searchParams, { page: String(page + 1) })}
            >
              Sonraki ›
            </Link>
          ) : (
            <span className="rounded-md border px-3 py-1.5 text-gray-400">Sonraki ›</span>
          )}
        </div>
      </div>

      {/* Geri */}
      <div className="mt-6">
        <Link
          href={`/tournaments/${tournamentId}?tab=matches`}
          className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Turnuva detayına dön
        </Link>
      </div>
    </main>
  );
}
