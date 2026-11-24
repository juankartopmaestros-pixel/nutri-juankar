// API Nutri Juankar · POST /functions/v1/analizar
// Recibe una foto (base64), la lee con Claude, aplica las reglas CDIET y devuelve el semáforo.
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { PROMPT, puntuar, REGLAS, type Extraccion } from "./reglas.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fallo = (status: number, codigo: string, mensaje: string) => json({ error: { codigo, mensaje } }, status);

// Precio por millón de tokens (entrada, salida) en dólares.
const PRECIOS: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-haiku-5-5": [0.1, 0.5],
};
const MODELO = Deno.env.get("MODELO") || "claude-opus-5-5";
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ reglas: REGLAS });
  if (req.method !== "POST") return fallo(405, "metodo", "Usa POST para analizar una foto.");

  const inicio = Date.now();
  let body: { imagen?: string; media_type?: string; momento?: string | null; codigo_acceso?: string };
  try { body = await req.json(); } catch { return fallo(400, "json", "La petición no es un JSON válido."); }

  // 1. Código de acceso y límite diario
  const codigo = (body.codigo_acceso || "").trim().toUpperCase();
  if (!codigo) return fallo(401, "codigo", "Falta el código de acceso.");
  const { data: acceso } = await db.from("codigos_acceso").select("codigo, limite_diario, activo").eq("codigo", codigo).maybeSingle();
  if (!acceso || !acceso.activo) return fallo(401, "codigo", "Revisa tu código de acceso.");
  const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("analisis").select("id", { count: "exact", head: true }).eq("codigo", codigo).gte("creado", hoy.toISOString());
  if ((count ?? 0) >= acceso.limite_diario) return fallo(429, "limite", "Has llegado al máximo de fotos de hoy.");

  // 2. Foto
  const imagen = (body.imagen || "").replace(/^data:[^,]+,/, "");
  const tipo = TIPOS.includes(body.media_type || "") ? body.media_type! : "image/jpeg";
  if (imagen.length < 1000) return fallo(400, "foto", "Falta la foto o está vacía.");
  if (imagen.length > 6_500_000) return fallo(400, "foto", "La foto es demasiado grande. Redúcela a 1600 px.");

  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!clave) return fallo(500, "configuracion", "Falta la clave de Anthropic en el servidor.");
  const claude = new Anthropic({ apiKey: clave });

  // 3. Claude lee la foto
  const momento = body.momento === "desayuno" || body.momento === "cena" ? body.momento : null;
  const texto = PROMPT + (momento ? `\n\nLa persona quiere tomarlo en el ${momento}; tenlo en cuenta en "plan".` : "");
  let respuesta;
  try {
    const peticion: Record<string, unknown> = {
      model: MODELO,
      max_tokens: 16000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: tipo, data: imagen } },
        { type: "text", text: texto },
      ] }],
    };
    if (MODELO.startsWith("claude-opus")) {
      peticion.betas = ["server-side-fallback-2026-07-01"];
      peticion.fallbacks = "default";
    }
    // deno-lint-ignore no-explicit-any
    respuesta = await claude.beta.messages.create(peticion as any);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fallo(500, "configuracion", "La clave de Anthropic del servidor no es válida.");
    if (e instanceof Anthropic.RateLimitError) return fallo(429, "saturado", "Demasiadas peticiones. Inténtalo en un minuto.");
    if (e instanceof Anthropic.BadRequestError) {
      const m = String((e as Error).message || "");
      if (/credit balance/i.test(m)) return fallo(502, "sin_saldo", "La cuenta de Anthropic no tiene saldo.");
      return fallo(400, "foto", "Esta foto no se puede leer. Prueba con otra.");
    }
    if (e instanceof Anthropic.APIError) return fallo(502, "ia", "Claude no responde ahora mismo. Inténtalo en un rato.");
    return fallo(502, "conexion", "No se pudo contactar con Claude.");
  }

  if (respuesta.stop_reason === "refusal") return fallo(422, "rechazo", "Claude no ha podido analizar esta foto. Prueba con otra.");
  const salida = respuesta.content.filter((b: { type: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("");
  let x: Extraccion;
  try { x = JSON.parse(salida.slice(salida.indexOf("{"), salida.lastIndexOf("}") + 1)); }
  catch { return fallo(502, "respuesta", "La respuesta no se ha podido leer. Vuelve a intentarlo."); }
  if (!x || x.name === "No reconocido") return fallo(422, "no_comida", "No he reconocido comida en la foto. Prueba más cerca y con buena luz.");

  // 4. Reglas CDIET, siempre en el servidor
  const r = puntuar(x);
  const u = respuesta.usage as unknown as Record<string, number>;
  const [pin, pout] = PRECIOS[respuesta.model] || PRECIOS[MODELO] || [4, 20];
  const entrada = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const coste = Math.round(((entrada * pin + (u.output_tokens || 0) * pout) / 1e6) * 10000) / 10000;

  const resultado = {
    nombre: x.name || "Alimento",
    tipo: x.kind || null,
    estimado: !!x.estimated,
    fresco: !!x.fresh,
    resumen: x.summary || null,
    avisos: x.warnings || [],
    ...r,
    plan: { momento: x.plan?.when || null, motivo: x.plan?.why || null },
    version_reglas: REGLAS.version,
    modelo: respuesta.model,
    coste_usd: coste,
  };

  // 5. Guardar (sin la foto)
  const { data: fila } = await db.from("analisis").insert({
    codigo, nombre: resultado.nombre, tipo: resultado.tipo, estimado: resultado.estimado, fresco: resultado.fresco,
    por_100g: r.por_100g, semaforo: r.semaforo, ingredientes: r.ingredientes, nota: r.nota, veredicto: r.veredicto,
    plan: resultado.plan, version_reglas: REGLAS.version, modelo: respuesta.model, coste_usd: coste,
    duracion_ms: Date.now() - inicio,
  }).select("id").single();

  return json({ id: fila?.id ?? null, ...resultado });
});
