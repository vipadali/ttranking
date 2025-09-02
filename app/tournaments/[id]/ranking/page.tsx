// app/tournaments/[id]/ranking/page.tsx
// Tek dosya, SSR. Filtreler: q (isim/klüp), gender (F/M), event, sayfa (page).
// Sıralamayı position ASC verir.

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export const revalidate = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

type RankingRow = {
  id: string;
  tournament_id: string;
  gender: "F" | "M" | null;
  event: string | null;
  position: number;
  athlete_display: string;
  club: string | null;
  created_at: string | null;
};

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

export default async function RankingPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    q?: string;
    gender?: "F" | "M";
    event?: string;
    page?: string;
  };
}) {
  const tournamentId = params.id;
  const q = (searchParams.q ?? "").trim();
  const gender =
    searchParams.gender === "F" || searchParams.gender === "M"
      ? searchParams.gender
      : undefined;
  const event = (searchParams.event ?? "").trim() || undefined;

  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const uiErrors: string[] = [];

  // 1) Distinct event listesi (dropdown için)
  let eventOptions: string[] = [];
  try {
    const { data, error } = await supabase
      .from("ranking")
      .select("event")
      .eq("tournament_id", tournamentId)
      .not("event", "is", null)
      .order("event", { ascending: true })
      .limit(500);
    if (error) throw error;
    const set = new Set<string>();
    (data ?? []).forEach((r: { event: string | null }) => {
      if (r.event) set.add(r.event);
    });
    eventOptions = Array.from(set);
  } catch (err: any) {
    uiErrors.push(
      `Etkinlik listesi yüklenemedi: ${err?.message ?? "Bilinmeyen hata"}`
    );
  }

  // 2) Ranking sorgusu
  let rows: RankingRow[] = [];
  let totalCount = 0;
  try {
    let query = supabase
      .from("ranking")
      .select("*", { count: "exact" })
      .eq("tournament_id", tournamentId);

    if (gender) query = query.eq("gender", gender);
    if (event) query = query.ilike("event", event);

    if (q) {
      query = query.or(
        `athlete_display.ilike.%${q}%,club.ilike.%${q}%`
      );
    }

    query = query
      .order("position", { ascending: true })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;
    rows = data ?? [];
    totalCount = count ?? 0;
  } catch (err: any) {
    uiErrors.push(
      `Sıralama yüklenirken hata: ${err?.message ?? "Bilinmeyen hata"}`
    );
  }

  // 3) Render
  return renderPage({
    tournamentId,
    rows,
    eventOptions,
    count: totalCount,
    page,
    pageSize: PAGE_SIZE,
    searchParams,
    uiErrors,
  });
}

function renderPage({
  tournamentId,
  rows,
  eventOptions,
  count,
  page,
  pageSize,
  searchParams,
  uiErrors,
}: {
  tournamentId: string;
  rows: RankingRow[];
  eventOptions: string[];
  count: number;
  page: number;
  pageSize: number;
  searchParams: Record<string, any>;
  uiErrors: string[];
}) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-xl font-semibold">Sıralama</h1>

      {/* Filtreler */}
      <form
        method="get"
        className="mt-4 grid grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-6"
      >
        <input
          type="text"
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="Sporcu / Kulüp ara"
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
          name="event"
          defaultValue={searchParams.event ?? ""}
          className="rounded-md border px-3 py-2 text-sm outline-none"
        >
          <option value="">Tüm etkinlikler</option>
          {eventOptions.map((e) => (
            <option key={e} value={e}>
              {e}
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
          <button
            type="submit"
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Ara
          </button>
          <Link
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            href={`/tournaments/${tournamentId}/ranking`}
          >
            Temizle
          </Link>
        </div>
      </form>

      {/* UI Hataları */}
      {uiErrors.length > 0 && (
        <div className="mt-4 space-y-2">
          {uiErrors.map((e, i) => (
            <div
              key={i}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {e}
            </div>
          ))}
        </div>
      )}

      {/* Liste */}
      <section className="mt-4 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="rounded-lg border p-4 text-sm text-gray-700">
            Kayıt bulunamadı.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Sıra</th>
                <th className="px-3 py-2 text-left font-medium">Sporcu</th>
                <th className="px-3 py-2 text-left font-medium">Kulüp</th>
                <th className="px-3 py-2 text-left font-medium">Cinsiyet</th>
                <th className="px-3 py-2 text-left font-medium">Etkinlik</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="px-3 py-2">{r.position}</td>
                  <td className="px-3 py-2">{r.athlete_display}</td>
                  <td className="px-3 py-2">{r.club ?? "—"}</td>
                  <td className="px-3 py-2">{r.gender ?? "—"}</td>
                  <td className="px-3 py-2">{r.event ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Sayfalama */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <div>
          Toplam <b>{count}</b> satır · Sayfa <b>{page}</b>/<b>{totalPages}</b>
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
            <span className="rounded-md border px-3 py-1.5 text-gray-400">
              ‹ Önceki
            </span>
          )}
          {hasNext ? (
            <Link
              className="rounded-md border px-3 py-1.5 hover:bg-gray-50"
              href={qs(searchParams, { page: String(page + 1) })}
            >
              Sonraki ›
            </Link>
          ) : (
            <span className="rounded-md border px-3 py-1.5 text-gray-400">
              Sonraki ›
            </span>
          )}
        </div>
      </div>

      {/* Geri */}
      <div className="mt-6">
        <Link
          href={`/tournaments/${tournamentId}?tab=ranking`}
          className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Turnuva detayına dön
        </Link>
      </div>
    </main>
  );
}
