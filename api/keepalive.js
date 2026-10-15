// Täglicher Keepalive: ein harmloser Lesezugriff auf Supabase, damit das
// Free-Projekt wegen Inaktivität nicht pausiert wird.
// Wird von Vercel Cron (siehe vercel.json) aufgerufen. Verändert keine Daten.

const PUBLIC_FALLBACK_KEY = 'sb_publishable_KlrmVMrzvmosZXDXbgs7Kg_sP5iwfGX'; // öffentlicher Publishable Key, kein Geheimnis

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    return res.status(503).json({ ok: false, error: 'SUPABASE_URL fehlt' });
  }
  const key = process.env.SUPABASE_ANON_KEY || PUBLIC_FALLBACK_KEY;

  try {
    const r = await fetch(`${url}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    // Auch eine leere Antwort (RLS) zählt als Datenbank-Aktivität.
    return res.status(200).json({ ok: r.ok, status: r.status, at: new Date().toISOString() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
