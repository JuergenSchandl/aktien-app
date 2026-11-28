// Aktien-App: Mitteilungen aufs Handy
// GET  ?key        öffentlicher Schlüssel, mit dem sich ein Gerät für Mitteilungen anmeldet
// POST ?test       Probe-Mitteilung an die eigenen Geräte (nur angemeldete Mitglieder)
// POST             Mitteilung an alle Geräte. Nur der Server kennt den Dienstschlüssel (push_keys.cron_key,
//                  Kopfzeile x-dienst); ohne ihn wird der Aufruf abgelehnt.
// Die Schlüssel erzeugt der Dienst beim ersten Aufruf selbst. Sie stehen nur in der Datenbank, nie im Code.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP = "https://juergenschandl.github.io/aktien-app/";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function schluessel(sb: any) {
  const { data } = await sb.from("push_keys").select("public_key, private_key, cron_key").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("push_keys").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
  return (await sb.from("push_keys").select("public_key, private_key, cron_key").eq("id", 1).single()).data;
}
// deno-lint-ignore no-explicit-any
async function senden(sb: any, subs: any[] | null, msg: Record<string, string>) {
  let n = 0;
  for (const s of subs || []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 3600, urgency: "high" }); n++; }
    catch (e) {
      // deno-lint-ignore no-explicit-any
      const c = (e as any)?.statusCode;
      if (c === 404 || c === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push", c);
    }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const keys = await schluessel(sb);
  const url = new URL(req.url);
  if (url.searchParams.has("key")) return json({ publicKey: keys.public_key });
  webpush.setVapidDetails(APP, keys.public_key, keys.private_key);

  if (url.searchParams.has("test")) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ error: "Nicht angemeldet" }, 401);
    const { data: m } = await sb.from("members").select("rolle").eq("user_id", u.user.id).maybeSingle();
    if (!m) return json({ error: "Kein Zugang" }, 403);
    const { data: subs } = await sb.from("push_subs").select("endpoint, sub").eq("user_id", u.user.id);
    return json({ gesendet: await senden(sb, subs, { title: "Aktien-App", body: "Mitteilungen sind eingeschaltet.", url: APP, tag: "test" }) });
  }

  if (req.method !== "POST" || !keys.cron_key || req.headers.get("x-dienst") !== keys.cron_key) return json({ error: "Kein Zugang" }, 401);
  // deno-lint-ignore no-explicit-any
  let m: any = {};
  try { m = await req.json(); } catch (_) { m = {}; }
  if (!m.title) return json({ error: "Titel fehlt" }, 400);
  const { data: subs } = await sb.from("push_subs").select("endpoint, sub");
  const gesendet = await senden(sb, subs, {
    title: String(m.title).slice(0, 120), body: String(m.body || "").slice(0, 300), url: APP + "#meldungen", tag: String(m.tag || "aktien"),
  });
  return json({ gesendet });
});
