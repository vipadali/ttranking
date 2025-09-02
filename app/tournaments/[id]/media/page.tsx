// app/tournaments/[id]/media/page.tsx
// Tek dosya, SSR. Filtreler: q (caption/credit), type (image/video), gender, event, page.
// Grid halinde linklenmiş kartlar.

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export const revalidate = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

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

export default async function MediaPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    q?: string;
    type?: "image" | "video";
    gender?: "F" | "M";
    event?: string;
    page?: string;
  };
}) {
  const tournamentId = params.id;
  const q = (searchParams.q ?? "").trim();
  const type =
    searchParams.type === "image" || searchParams.type === "video"
      ? searchParams.type
      : undefined;
  const gender =
    searchParams.gender === "F" || searchParams.gender === "M"
      ? searchParams.gender
      : undefined;
  const event = (searchParams.event ?? "").trim() || undefined;

  const PAGE_SIZE = 24;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const uiErrors: string[] = [];

  // 1) Distinct event listesi (dropdown)
  let eventOptions: string[] = [];
  try {
    const { data, error } = await supabase
      .from("media")
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

  // 2) Media sorgusu
  let items: MediaRow[] = [];
  let totalCount = 0;

  try {
    let query = supabase
      .from("media")
      .select("*", { count: "exact" })
      .eq("tournament_id", tournamentId);

    if (type) query = query.eq("type", type);
    if (gender) query = query.eq("gender", gender);
    if (event) query = query.ilike("event", event);
    if (q) {
      query = query.or(
        `caption.ilike.%${q}%,credit.ilike.%${q}%`
      );
    }

    query = query.order("created_at", { ascending: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;
    items = data ?? [];
    totalCount = count ?? 0;
  } catch (err: any) {
    uiErrors.push(
      `Medya yüklenirken hata: ${err?.message ?? "Bilinmeyen hata"}`
    );
  }

  // 3) Render
  return renderPage({
    tournamentId,
    items,
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
  items,
  eventOptions,
  count,
  page,
  pageSize,
  searchParams,
  uiErrors,
}: {
  tournamentId: string;
  items: MediaRow[];
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
      <h1 className="text-xl font-semibold">Medya</h1>

      {/* Filtreler */}
      <form
        method="get"
        className="mt-4 grid grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-6"
      >
        <input
          type="text"
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="Açıklama / Kredi ara"
          className="col-span-2 rounded-md border px-3 py-2 text-sm outline-none"
        />
        <select
          name="type"
          defaultValue={searchParams.type ?? ""}
          className="rounded-md border px-3 py-2 text-sm outline-none"
        >
          <option value="">Tümü</option>
          <option value="image">Görsel</option>
          <option value="video">Video</option>
        </select>
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
            href={`/tournaments/${tournamentId}/media`}
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

      {/* Grid */}
      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.length === 0 && (
          <div className="col-span-full rounded-lg border p-4 text-sm text-gray-700">
            Kayıt bulunamadı.
          </div>
        )}

        {items.map((m) => (
          <a
            key={m.id}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="group relative block overflow-hidden rounded border"
            title={m.caption ?? m.url}
          >
            {/* Uzaktan görsel yükleme için Next/Image domain ayarı gerekebilir.
               Bu yüzden burada bilinçli olarak "thumb placeholder" kullanıyoruz. */}
            <div className="aspect-[4/5] bg-gray-100" />
            <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/40 via-black/0 to-transparent p-2">
              <div className="text-xs text-white">
                {m.caption ?? (m.type === "video" ? "Video" : "Görsel")}
                {m.is_cover ? (
                  <span className="ml-1 rounded bg-white/80 px-1 text-[10px] text-black">
                    Kapak
                  </span>
                ) : null}
                {m.credit ? <span className="ml-2 opacity-80">{m.credit}</span> : null}
              </div>
            </div>
          </a>
        ))}
      </section>

      {/* Sayfalama */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <div>
          Toplam <b>{count}</b> medya · Sayfa <b>{page}</b>/{Math.max(1, Math.ceil(count / pageSize))}
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
          href={`/tournaments/${tournamentId}?tab=media`}
          className="inline-block rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Turnuva detayına dön
        </Link>
      </div>
    </main>
  );
}
