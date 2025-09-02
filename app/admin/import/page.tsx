// app/admin/import/page.tsx
// XLSX/CSV Toplu İçe Aktarma + Sayfa/Alan Eşleştirme (Roster & Matches 2 adımlı)
// Gender dosyadan alınmaz; UI'dan seçilir.

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export const revalidate = 0;

/* -------------------- Redirect yakalamayı önle -------------------- */
// Next.js'te redirect() exception fırlatır. Bunu kendi catch'imizde
// "NEXT_REDIRECT" digest'inden tanıyıp tekrar fırlatıyoruz.
function isNextRedirectError(e: unknown): e is { digest: string } {
  return !!(
    e &&
    typeof e === "object" &&
    "digest" in (e as any) &&
    typeof (e as any).digest === "string" &&
    (e as any).digest.startsWith("NEXT_REDIRECT")
  );
}
function rethrowRedirect(e: unknown) {
  if (isNextRedirectError(e)) throw e;
}
/* ----------------------------------------------------------------- */

// ---------- Supabase (server-only client) ----------
const supaAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // yalnızca server
  { auth: { persistSession: false } }
);

// ---------- yardımcılar ----------
function assertAdmin(form: FormData) {
  const token = String(form.get("admin_token") || "");
  const expected = process.env.ADMIN_ACCESS_TOKEN || "";
  if (!expected) throw new Error("ADMIN_ACCESS_TOKEN .env.local içinde eksik.");
  if (token !== expected) throw new Error("Yetkisiz işlem: admin token hatalı.");
}
const toStr = (v: unknown) => {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
};
const toBool = (v: unknown) => {
  const s = (v ?? "").toString().trim().toLowerCase();
  if (!s) return null;
  return ["1", "true", "yes", "evet"].includes(s);
};
const toISO = (v: unknown) => {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

// aksan/küçük-büyük duyarsızlaştırma (TR uyumlu)
function norm(s: string | null) {
  if (!s) return "";
  return s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Tam isim parçalama: "Soyad, Ad" veya "Ad Soyad"
function splitFullName(full: string) {
  const s = full.trim();
  if (!s) return { first: "", last: "" };
  if (s.includes(",")) {
    const [l, r] = s.split(",").map((x) => x.trim());
    return { first: r || "", last: l || "" };
  }
  const parts = s.split(/\s+/);
  if (parts.length < 2) return { first: s, last: "" };
  const last = parts.pop() as string;
  const first = parts.join(" ");
  return { first, last };
}

// CSV ayrıştır ("," ";" TAB)
function parseCSV(text: string, delimiter: "," | ";" | "\t") {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };

  function splitLine(line: string) {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === delimiter && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  const headers = splitLine(lines[0]);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    while (cols.length < headers.length) cols.push("");
    rows.push(cols);
  }
  return { headers, rows };
}

// XLSX/CSV'yi {sheetNames, headersBySheet} olarak analiz et
async function introspectFile(file: File, delimiter: "," | ";" | "\t") {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  if (name.endsWith(".xlsx") || type.includes("spreadsheetml")) {
    const buf = await file.arrayBuffer();
    const XLSX: any = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const sheetNames: string[] = wb.SheetNames || [];
    const headersBySheet: Record<string, string[]> = {};
    for (const s of sheetNames) {
      const ws = wb.Sheets[s];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      const headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
      headersBySheet[s] = headers;
    }
    return { sheetNames, headersBySheet };
  }

  const text = await file.text();
  const { headers } = parseCSV(text, delimiter);
  return { sheetNames: ["CSV"], headersBySheet: { CSV: headers } };
}

// (Adım-B) seçilen sayfayı satırlarıyla oku
async function readSheetRows(file: File, sheetName: string, delimiter: "," | ";" | "\t") {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  if (name.endsWith(".xlsx") || type.includes("spreadsheetml")) {
    const buf = await file.arrayBuffer();
    const XLSX: any = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const s = sheetName || (wb.SheetNames?.[0] ?? "");
    const ws = wb.Sheets[s];
    if (!ws) throw new Error(`Seçilen sayfa bulunamadı: ${sheetName}`);
    const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    const headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
    const rows = aoa.slice(1).map((r) => headers.map((_, i) => String((r ?? [])[i] ?? "").trim()));
    return { headers, rows };
  }

  const text = await file.text();
  const { headers, rows } = parseCSV(text, delimiter);
  return { headers, rows };
}

// toplu insert (500'erli)
async function insertChunked<T>(table: string, rows: T[]) {
  let inserted = 0;
  const size = 500;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const { error, count } = await supaAdmin.from(table).insert(slice as any, { count: "exact" });
    if (error) throw error;
    inserted += count ?? slice.length;
  }
  return inserted;
}

// isim → roster id eşleşmesi için indeks (matches için)
async function buildRosterIndex(tournament_id: string, genderSel: "M" | "F" | null) {
  const { data, error } = await supaAdmin
    .from("tournament_roster")
    .select("id,first_name,last_name,club,gender")
    .eq("tournament_id", tournament_id);
  if (error) throw error;
  const list = (data ?? []).filter(r => !genderSel || r.gender === genderSel);
  const map = new Map<string, { id: string; club: string | null }[]>();
  function addKey(k: string, row: any) {
    const key = norm(k);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ id: row.id, club: row.club });
  }
  for (const r of list) {
    const full = `${r.first_name} ${r.last_name}`;
    const rev  = `${r.last_name} ${r.first_name}`;
    addKey(full, r);
    addKey(rev, r);
  }
  return map;
}
function resolveNameToId(
  map: Map<string, { id: string; club: string | null }[]>,
  fullName: string | null,
  clubHint?: string | null
) {
  if (!fullName) return { ok: false as const, reason: "isim boş" };
  const cand = map.get(norm(fullName)) ?? [];
  if (cand.length === 0) return { ok: false as const, reason: "eşleşme yok" };
  if (cand.length === 1) return { ok: true as const, id: cand[0].id };
  if (clubHint) {
    const c = cand.find(x => norm(x.club || "") === norm(clubHint));
    if (c) return { ok: true as const, id: c.id };
  }
  return { ok: false as const, reason: "birden fazla eşleşme" };
}

// ---------- Server Actions ----------
// Roster – Adım A: analiz
async function prepareRosterAction(form: FormData) {
  "use server";
  try {
    assertAdmin(form);
    const tournament_id = toStr(form.get("tournament_id")) || "";
    const genderSel = toStr(form.get("gender_sel")) || "";
    const delim = String(form.get("delimiter") || ",") as "," | ";" | "\t";
    const file = form.get("file") as File | null;
    if (!file) throw new Error("Dosya seçilmedi.");
    const info = await introspectFile(file, delim);
    const payload = b64uEncode(JSON.stringify(info));
    redirect(`/admin/import?tid=${tournament_id}&g=${genderSel}&prepR=${payload}#roster`);
  } catch (e: any) {
    rethrowRedirect(e);
    redirect(`/admin/import?err=${encodeURIComponent(e.message || String(e))}#roster`);
  }
}

// Roster – Adım B: eşleştir & içe aktar
async function importRosterMappedAction(form: FormData) {
  "use server";
  try {
    assertAdmin(form);
    const tournament_id = toStr(form.get("tournament_id"));
    const genderSel = (toStr(form.get("gender_sel")) as "M" | "F" | null) ?? null;
    if (!tournament_id) throw new Error("Turnuva ID zorunlu.");
    const sheet = toStr(form.get("sheet_name")) || "";
    const delim = String(form.get("delimiter") || ",") as "," | ";" | "\t";
    const file = form.get("file") as File | null;
    if (!file) throw new Error("Dosya seçilmedi.");

    const full = toStr(form.get("map_full"));
    const first = toStr(form.get("map_first"));
    const last  = toStr(form.get("map_last"));
    const club  = toStr(form.get("map_club"));

    if (!(full || (first && last))) {
      throw new Error("Tam isim kolonu veya Ad + Soyad kolonlarını seçmelisiniz.");
    }

    const { headers, rows } = await readSheetRows(file, sheet, delim);
    const idx = new Map<string, number>();
    headers.forEach((h, i) => idx.set(h, i));
    const pick = (cols: string[], col?: string | null) => (col && idx.has(col) ? toStr(cols[idx.get(col)!]) : null);

    type Row = { tournament_id: string; first_name: string; last_name: string; gender: "M" | "F" | null; club: string | null };
    const out: Row[] = [];
    const issues: string[] = [];

    rows.forEach((cols, i) => {
      const line = i + 2;
      let f = "", l = "";

      if (full) {
        const val = pick(cols, full);
        const sp = splitFullName(val || "");
        f = sp.first;
        l = sp.last;
      } else {
        f = pick(cols, first) || "";
        l = pick(cols, last) || "";
      }

      if (!f || !l) {
        issues.push(`Satır ${line}: isim/soyisim eksik (first='${f}' last='${l}')`);
        return;
      }

      out.push({
        tournament_id: tournament_id!,
        first_name: f,
        last_name: l,
        gender: genderSel,
        club: pick(cols, club || undefined),
      });
    });

    if (issues.length) {
      const head = `Eksik/bozuk satırlar bulundu. Kayıt yapılmadı.\n` +
                   `İpucu: Tam isimde 'Soyad, Ad' veya 'Ad Soyad' kullanın; ya da Ad ve Soyad kolonlarını ayrı seçin.\n\n`;
      throw new Error(head + issues.slice(0, 100).join("\n"));
    }

    const inserted = await insertChunked("tournament_roster", out);
    redirect(`/admin/import?tid=${tournament_id}&msg=${encodeURIComponent(`Roster import OK · ${inserted} satır`)}#roster`);
  } catch (e: any) {
    rethrowRedirect(e);
    redirect(`/admin/import?err=${encodeURIComponent(e.message || String(e))}#roster`);
  }
}

// Matches – Adım A
async function prepareMatchesAction(form: FormData) {
  "use server";
  try {
    assertAdmin(form);
    const tournament_id = toStr(form.get("tournament_id")) || "";
    const genderSel = toStr(form.get("gender_sel")) || "";
    const delim = String(form.get("delimiter") || ",") as "," | ";" | "\t";
    const file = form.get("file") as File | null;
    if (!file) throw new Error("Dosya seçilmedi.");
    const info = await introspectFile(file, delim);
    const payload = b64uEncode(JSON.stringify(info));
    redirect(`/admin/import?tid=${tournament_id}&g=${genderSel}&prep=${payload}#matches`);
  } catch (e: any) {
    rethrowRedirect(e);
    redirect(`/admin/import?err=${encodeURIComponent(e.message || String(e))}#matches`);
  }
}

// Matches – Adım B
async function importMatchesMappedAction(form: FormData) {
  "use server";
  try {
    assertAdmin(form);
    const tournament_id = toStr(form.get("tournament_id"));
    const genderSel = (toStr(form.get("gender_sel")) as "M" | "F" | null) ?? null;
    if (!tournament_id) throw new Error("Turnuva ID zorunlu.");

    const sheet = toStr(form.get("sheet_name")) || "";
    const delim = String(form.get("delimiter") || ",") as "," | ";" | "\t";
    const file = form.get("file") as File | null;
    if (!file) throw new Error("Dosya seçilmedi.");

    const mapGet = (k: string) => toStr(form.get(k));
    const a_full = mapGet("map_a_full");   const a_first = mapGet("map_a_first"); const a_last = mapGet("map_a_last"); const a_club = mapGet("map_a_club");
    const b_full = mapGet("map_b_full");   const b_first = mapGet("map_b_first"); const b_last = mapGet("map_b_last"); const b_club = mapGet("map_b_club");
    const m_round = mapGet("map_round");   const m_sum = mapGet("map_score");     const m_sets = mapGet("map_sets");    const m_table = mapGet("map_table"); const m_time = mapGet("map_time");

    if (!(a_full || (a_first && a_last))) throw new Error("A oyuncu için tam isim veya ad+soyad kolonlarını seçin.");
    if (!(b_full || (b_first && b_last))) throw new Error("B oyuncu için tam isim veya ad+soyad kolonlarını seçin.");

    const { headers, rows } = await readSheetRows(file, sheet, delim);
    const H = new Map<string, number>();
    headers.forEach((h, i) => H.set(h, i));
    const pick = (cols: string[], col?: string | null) => (col && H.has(col) ? toStr(cols[H.get(col)!]) : null);

    const rosterMap = await buildRosterIndex(tournament_id!, genderSel);
    type Row = { tournament_id: string; player_a_roster_id: string; player_b_roster_id: string; gender: "M" | "F" | null; round: string | null; score_summary: string | null; sets: string | null; table_no: string | null; started_at: string | null; };
    const out: Row[] = [];
    const issues: string[] = [];

    rows.forEach((cols, idx) => {
      const line = idx + 2;
      const aFull = a_full ? pick(cols, a_full) : [pick(cols, a_first), pick(cols, a_last)].filter(Boolean).join(" ");
      const bFull = b_full ? pick(cols, b_full) : [pick(cols, b_first), pick(cols, b_last)].filter(Boolean).join(" ");
      const aClubV = pick(cols, a_club || undefined);
      const bClubV = pick(cols, b_club || undefined);

      const aRes = resolveNameToId(rosterMap, aFull, aClubV);
      const bRes = resolveNameToId(rosterMap, bFull, bClubV);
      if (!(aRes as any).ok || !(bRes as any).ok) {
        const aMsg = (aRes as any).ok ? "" : `A[${aFull}] → ${aRes.reason}`;
        const bMsg = (bRes as any).ok ? "" : `B[${bFull}] → ${bRes.reason}`;
        issues.push(`Satır ${line}: ${[aMsg, bMsg].filter(Boolean).join(" | ")}`);
        return;
      }

      out.push({
        tournament_id: tournament_id!,
        player_a_roster_id: (aRes as any).id,
        player_b_roster_id: (bRes as any).id,
        gender: genderSel ?? null,
        round: pick(cols, m_round || undefined),
        score_summary: pick(cols, m_sum   || undefined),
        sets:          pick(cols, m_sets  || undefined),
        table_no:      pick(cols, m_table || undefined),
        started_at:    toISO(pick(cols, m_time || undefined)),
      });
    });

    if (issues.length) {
      const head = `Eşleşmeyen/Akışık satırlar bulundu. Kayıt yapılmadı.\nİpucu: İsimleri roster ile birebir aynı yazın veya kulüp ipucu (a_club/b_club) girin.\n\n`;
      throw new Error(head + issues.slice(0, 100).join("\n"));
    }

    const inserted = await insertChunked("matches", out);
    redirect(`/admin/import?tid=${tournament_id}&msg=${encodeURIComponent(`Matches import OK · ${inserted} satır`)}#matches`);
  } catch (e: any) {
    rethrowRedirect(e);
    redirect(`/admin/import?err=${encodeURIComponent(e.message || String(e))}#matches`);
  }
}

// Ranking (basit)
async function importRankingAction(form: FormData) {
  "use server";
  try {
    assertAdmin(form);
    const tournament_id = toStr(form.get("tournament_id"));
    const genderSel = (toStr(form.get("gender_sel")) as "M" | "F" | null) ?? null;
    if (!tournament_id) throw new Error("Turnuva ID zorunlu.");

    const file = form.get("file") as File | null;
    const delim = String(form.get("delimiter") || ",") as "," | ";" | "\t";
    if (!file) throw new Error("Dosya seçilmedi.");

    const { headers, rows } = await readSheetRows(file, "", delim);
    const H = headers.map(h => h.toLowerCase());

    const out = rows.map(cols => {
      const get = (n: string) => toStr(cols[H.indexOf(n)]);
      return {
        tournament_id,
        position: Number(get("position") || "0"),
        athlete_display: get("athlete_display") ?? "",
        gender: genderSel,
        event: get("event"),
        club: get("club"),
      };
    }).filter(r => r.position > 0 && r.athlete_display);

    const inserted = await insertChunked("ranking", out);
    redirect(`/admin/import?tid=${tournament_id}&msg=${encodeURIComponent(`Ranking import OK · ${inserted} satır`)}#ranking`);
  } catch (e: any) {
    rethrowRedirect(e);
    redirect(`/admin/import?err=${encodeURIComponent(e.message || String(e))}#ranking`);
  }
}

// Media (basit)
async function importMediaAction(form: FormData) {
  "use server";
  try {
    assertAdmin(form);
    const tournament_id = toStr(form.get("tournament_id"));
    const genderSel = (toStr(form.get("gender_sel")) as "M" | "F" | null) ?? null;
    if (!tournament_id) throw new Error("Turnuva ID zorunlu.");

    const file = form.get("file") as File | null;
    const delim = String(form.get("delimiter") || ",") as "," | ";" | "\t";
    if (!file) throw new Error("Dosya seçilmedi.");

    const { headers, rows } = await readSheetRows(file, "", delim);
    const H = headers.map(h => h.toLowerCase());

    const out = rows.map(cols => {
      const get = (n: string) => toStr(cols[H.indexOf(n)]);
      return {
        tournament_id,
        type: (get("type") as "image" | "video") || "image",
        url: get("url") ?? "",
        caption: get("caption"),
        credit: get("credit"),
        is_cover: toBool(get("is_cover")),
        gender: genderSel,
        event: get("event"),
        created_at: toISO(get("created_at")),
      };
    }).filter(r => r.url);

    const inserted = await insertChunked("media", out);
    redirect(`/admin/import?tid=${tournament_id}&msg=${encodeURIComponent(`Media import OK · ${inserted} satır`)}#media`);
  } catch (e: any) {
    rethrowRedirect(e);
    redirect(`/admin/import?err=${encodeURIComponent(e.message || String(e))}#media`);
  }
}

// ---------- XLSX şablon ----------
async function xlsxDataUrl(aoa: (string | number | boolean | null)[][], sheet = "Template") {
  const XLSX: any = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + b64;
}
function link(href: string, label: string) {
  return <a className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50" href={href} download>{label}</a>;
}

// base64url
function b64uEncode(s: string) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64uDecode(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

type Tourn = { id: string; name: string; year: number | null; city: string | null; status: string };

// ---------- UI ----------
export default async function ImportPage({
  searchParams,
}: { searchParams: { tid?: string; msg?: string; err?: string; prep?: string; prepR?: string; g?: string } }) {
  const tid = searchParams.tid ?? "";
  const msg = searchParams.msg ?? "";
  const err = searchParams.err ?? "";
  const gSel = searchParams.g ?? "";

  // Turnuvalar
  const { data: tournamentsRaw } = await supaAdmin
    .from("tournaments")
    .select("id,name,year,city,status")
    .order("created_at", { ascending: false })
    .limit(50);
  const tournaments: Tourn[] = (tournamentsRaw ?? []) as any;

  // Şablonlar
  const rosterX = await xlsxDataUrl([
    ["full_name", "club"],
    ["Ahmet Yılmaz", "İstanbul BŞB"],
    ["Mehmet Kaya", "Galatasaray"],
  ]);
  const matchesX = await xlsxDataUrl([
    ["player_a", "player_b", "round", "score_summary", "sets", "table_no", "started_at", "a_club", "b_club"],
    ["Ahmet Yılmaz", "Mehmet Kaya", "sf", "3-2", "11-8,9-11,11-9,8-11,11-7", "2", "2025-09-01 15:30", "", ""],
  ]);
  const rankingX = await xlsxDataUrl([["position", "athlete_display", "event", "club"], [1, "Ahmet Yılmaz", "Açık Tekler", "İstanbul BŞB"]]);
  const mediaX = await xlsxDataUrl([["type", "url", "caption", "credit", "is_cover", "event", "created_at"], ["image", "https://picsum.photos/seed/p1/800/1000", "Podyum", "Org", true, "Açık Tekler", "2025-09-01 18:00"]]);

  let prepR: { sheetNames: string[]; headersBySheet: Record<string, string[]> } | null = null;
  if (searchParams.prepR) { try { prepR = JSON.parse(b64uDecode(searchParams.prepR)); } catch {} }

  let prep: { sheetNames: string[]; headersBySheet: Record<string, string[]> } | null = null;
  if (searchParams.prep) { try { prep = JSON.parse(b64uDecode(searchParams.prep)); } catch {} }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <h1 className="text-2xl font-semibold">XLSX/CSV İçe Aktarma – TMTF</h1>

      {!!err && <pre className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</pre>}
      {!!msg && <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</div>}

      {/* Turnuva seçimi */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Turnuva Seç</h2>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select name="tid" defaultValue={tid} className="rounded-md border px-3 py-2 text-sm min-w-[320px]">
            <option value="">— Turnuva seç —</option>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} {t.year ? `(${t.year})` : ""} · {t.city ?? "—"} · {t.status}</option>)}
          </select>
          <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">Yükle</button>
          {tid && <a className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" href={`/tournaments/${tid}`} target="_blank">Detayı aç ↗</a>}
        </form>
        <div className="text-xs text-gray-600">
          Şablonlar: {link(rosterX, "Roster.xlsx")} · {link(matchesX, "Matches.xlsx")} · {link(rankingX, "Ranking.xlsx")} · {link(mediaX, "Media.xlsx")}
        </div>
      </section>

      {/* ROSTER – Adım A & B */}
      <section id="roster" className="rounded-lg border p-4 space-y-3">
        <h3 className="text-lg font-semibold">1) Roster (Katılımcı) – Adım A: Dosyayı Analiz Et</h3>
        <FormPrepare action={prepareRosterAction} tid={tid} tournaments={tournaments} defaultGender={gSel}
          help="XLSX/CSV seç → Analiz Et. Sonra sayfa/kolonları eşleştirerek içe aktar." />
        {prepR && (
          <div className="mt-6 rounded-lg border p-4 space-y-3">
            <h4 className="text-base font-semibold">Adım B: Sayfa & Kolon Eşleştir → İçe Aktar</h4>
            <FormRosterMapped action={importRosterMappedAction} tid={tid} tournaments={tournaments} defaultGender={gSel} prep={prepR} />
          </div>
        )}
      </section>

      {/* MATCHES – Adım A & B */}
      <section id="matches" className="rounded-lg border p-4 space-y-3">
        <h3 className="text-lg font-semibold">2) Matches (Maçlar) – Adım A: Dosyayı Analiz Et</h3>
        <FormPrepare action={prepareMatchesAction} tid={tid} tournaments={tournaments} defaultGender={gSel}
          help="XLSX/CSV seç → Analiz Et. Ardından sayfa/kolon eşleştir." />
        {prep && (
          <div className="mt-6 rounded-lg border p-4 space-y-3">
            <h4 className="text-base font-semibold">Adım B: Sayfa & Kolon Eşleştir → İçe Aktar</h4>
            <FormMatchesMapped action={importMatchesMappedAction} tid={tid} tournaments={tournaments} defaultGender={gSel} prep={prep} />
          </div>
        )}
      </section>

      {/* RANKING */}
      <section id="ranking" className="rounded-lg border p-4 space-y-3">
        <h3 className="text-lg font-semibold">3) Ranking (Sıralama) içe aktar</h3>
        <FormSimple action={importRankingAction} tid={tid} tournaments={tournaments} showGender
          help="Başlıklar: position,athlete_display,event,club — Cinsiyet dosyada yok; aşağıdan seç." />
      </section>

      {/* MEDIA */}
      <section id="media" className="rounded-lg border p-4 space-y-3">
        <h3 className="text-lg font-semibold">4) Media (Medya) içe aktar</h3>
        <FormSimple action={importMediaAction} tid={tid} tournaments={tournaments} showGender
          help="Başlıklar: type,url,caption,credit,is_cover,event,created_at — Cinsiyet dosyada yok; aşağıdan seç." />
      </section>
    </main>
  );
}

// ----------- Form bileşenleri -----------
function FormSimple({
  action, tid, tournaments, help, showGender = false,
}: { action: (f: FormData) => Promise<void>; tid: string; tournaments: Tourn[]; help: string; showGender?: boolean; }) {
  return (
    <form action={action} encType="multipart/form-data" className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
      <select name="tournament_id" defaultValue={tid} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required>
        <option value="">— Turnuva seç —</option>
        {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} {t.year ? `(${t.year})` : ""} · {t.city ?? "—"} · {t.status}</option>)}
      </select>
      {showGender ? (
        <select name="gender_sel" defaultValue="" className="rounded-md border px-3 py-2 text-sm">
          <option value="">Cinsiyet: (boş bırak)</option>
          <option value="M">Erkek (M)</option>
          <option value="F">Kadın (F)</option>
        </select>
      ) : <input type="hidden" name="gender_sel" value="" />}
      <select name="delimiter" className="rounded-md border px-3 py-2 text-sm">
        <option value=",">CSV ayırıcı: ,</option>
        <option value=";">CSV ayırıcı: ;</option>
        <option value="\t">CSV ayırıcı: TAB</option>
      </select>
      <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" className="rounded-md border px-3 py-2 text-sm md:col-span-6" required />
      <div className="md:col-span-6 text-xs text-gray-600">{help}</div>
      <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">İçe aktar</button>
    </form>
  );
}

function FormPrepare({
  action, tid, tournaments, defaultGender = "", help,
}: { action: (f: FormData) => Promise<void>; tid: string; tournaments: Tourn[]; defaultGender?: string; help: string; }) {
  return (
    <form action={action} encType="multipart/form-data" className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
      <select name="tournament_id" defaultValue={tid} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required>
        <option value="">— Turnuva seç —</option>
        {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} {t.year ? `(${t.year})` : ""} · {t.city ?? "—"} · {t.status}</option>)}
      </select>
      <select name="gender_sel" defaultValue={defaultGender} className="rounded-md border px-3 py-2 text-sm">
        <option value="">Cinsiyet: (boş bırak)</option>
        <option value="M">Erkek (M)</option>
        <option value="F">Kadın (F)</option>
      </select>
      <select name="delimiter" className="rounded-md border px-3 py-2 text-sm">
        <option value=",">CSV ayırıcı: ,</option>
        <option value=";">CSV ayırıcı: ;</option>
        <option value="\t">CSV ayırıcı: TAB</option>
      </select>
      <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" className="rounded-md border px-3 py-2 text-sm md:col-span-6" required />
      <div className="md:col-span-6 text-xs text-gray-600">{help}</div>
      <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">Analiz Et</button>
    </form>
  );
}

function FormRosterMapped({
  action, tid, tournaments, defaultGender = "", prep,
}: { action: (f: FormData) => Promise<void>; tid: string; tournaments: Tourn[]; defaultGender?: string; prep: { sheetNames: string[]; headersBySheet: Record<string, string[]> }; }) {
  const sheetFirst = prep.sheetNames[0] ?? "";
  const headersFirst = prep.headersBySheet[sheetFirst] ?? [];
  return (
    <form action={action} encType="multipart/form-data" className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
      <select name="tournament_id" defaultValue={tid} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required>
        <option value="">— Turnuva seç —</option>
        {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} {t.year ? `(${t.year})` : ""} · {t.city ?? "—"} · {t.status}</option>)}
      </select>
      <select name="gender_sel" defaultValue={defaultGender} className="rounded-md border px-3 py-2 text-sm">
        <option value="">Cinsiyet: (boş bırak)</option>
        <option value="M">Erkek (M)</option>
        <option value="F">Kadın (F)</option>
      </select>
      <select name="delimiter" className="rounded-md border px-3 py-2 text-sm">
        <option value=",">CSV ayırıcı: ,</option>
        <option value=";">CSV ayırıcı: ;</option>
        <option value="\t">CSV ayırıcı: TAB</option>
      </select>

      <label className="text-xs text-gray-600 md:col-span-6">Sayfa (Sheet)</label>
      <select name="sheet_name" defaultValue={sheetFirst} className="rounded-md border px-3 py-2 text-sm md:col-span-3">
        {prep.sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium text-sm">İsim Alanları</div>
          <SelectCol name="map_full"  label="Tam isim kolonu (örn 'Ahmet Yılmaz' veya 'Yılmaz, Ahmet')" headers={headersFirst} />
          <div className="text-xs text-gray-500">— veya —</div>
          <SelectCol name="map_first" label="Ad kolonu" headers={headersFirst} />
          <SelectCol name="map_last"  label="Soyad kolonu" headers={headersFirst} />
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium text-sm">Diğer</div>
          <SelectCol name="map_club"  label="Kulüp (opsiyonel)" headers={headersFirst} />
        </div>
      </div>

      <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" className="rounded-md border px-3 py-2 text-sm md:col-span-6" required />
      <div className="md:col-span-6 text-xs text-gray-600">Not: Adım-A’da analiz ettiğiniz dosyanın aynısını burada tekrar seçin.</div>
      <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">İçe aktar</button>
    </form>
  );
}

function FormMatchesMapped({
  action, tid, tournaments, defaultGender = "", prep,
}: { action: (f: FormData) => Promise<void>; tid: string; tournaments: Tourn[]; defaultGender?: string; prep: { sheetNames: string[]; headersBySheet: Record<string, string[]> }; }) {
  const sheetFirst = prep.sheetNames[0] ?? "";
  const headersFirst = prep.headersBySheet[sheetFirst] ?? [];
  return (
    <form action={action} encType="multipart/form-data" className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <input name="admin_token" type="password" placeholder="Admin token" className="rounded-md border px-3 py-2 text-sm md:col-span-2" required />
      <select name="tournament_id" defaultValue={tid} className="rounded-md border px-3 py-2 text-sm md:col-span-2" required>
        <option value="">— Turnuva seç —</option>
        {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} {t.year ? `(${t.year})` : ""} · {t.city ?? "—"} · {t.status}</option>)}
      </select>
      <select name="gender_sel" defaultValue={defaultGender} className="rounded-md border px-3 py-2 text-sm">
        <option value="">Cinsiyet: (boş bırak)</option>
        <option value="M">Erkek (M)</option>
        <option value="F">Kadın (F)</option>
      </select>
      <select name="delimiter" className="rounded-md border px-3 py-2 text-sm">
        <option value=",">CSV ayırıcı: ,</option>
        <option value=";">CSV ayırıcı: ;</option>
        <option value="\t">CSV ayırıcı: TAB</option>
      </select>

      <label className="text-xs text-gray-600 md:col-span-6">Sayfa (Sheet)</label>
      <select name="sheet_name" defaultValue={sheetFirst} className="rounded-md border px-3 py-2 text-sm md:col-span-3">
        {prep.sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium text-sm">A Oyuncu</div>
          <SelectCol name="map_a_full" label="Tam isim kolonu" headers={headersFirst} />
          <div className="text-xs text-gray-500">— veya —</div>
          <SelectCol name="map_a_first" label="Ad kolonu" headers={headersFirst} />
          <SelectCol name="map_a_last"  label="Soyad kolonu" headers={headersFirst} />
          <SelectCol name="map_a_club"  label="Kulüp (opsiyonel ipucu)" headers={headersFirst} />
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium text-sm">B Oyuncu</div>
          <SelectCol name="map_b_full" label="Tam isim kolonu" headers={headersFirst} />
          <div className="text-xs text-gray-500">— veya —</div>
          <SelectCol name="map_b_first" label="Ad kolonu" headers={headersFirst} />
          <SelectCol name="map_b_last"  label="Soyad kolonu" headers={headersFirst} />
          <SelectCol name="map_b_club"  label="Kulüp (opsiyonel ipucu)" headers={headersFirst} />
        </div>
      </div>

      <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <SelectCol name="map_round" label="Tur kolonu" headers={headersFirst} />
        <SelectCol name="map_score" label="Skor özeti (örn 3-2)" headers={headersFirst} />
        <SelectCol name="map_sets"  label="Set detayları" headers={headersFirst} />
        <SelectCol name="map_table" label="Masa no" headers={headersFirst} />
        <SelectCol name="map_time"  label="Tarih/saat" headers={headersFirst} />
      </div>

      <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" className="rounded-md border px-3 py-2 text-sm md:col-span-6" required />
      <div className="md:col-span-6 text-xs text-gray-600">Not: Adım-A’da analiz ettiğiniz dosyanın aynısını burada tekrar seçin.</div>
      <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 md:col-span-6">İçe aktar</button>
    </form>
  );
}

function SelectCol({ name, label, headers }: { name: string; label: string; headers: string[] }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-gray-600">{label}</span>
      <select name={name} className="rounded-md border px-3 py-2 text-sm">
        <option value="">— boş —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
}
