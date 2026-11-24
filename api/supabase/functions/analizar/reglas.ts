// Reglas de Nutri Juankar. Fuente: hoja CDIET "Detective de etiquetas" de la nutricionista
// y su plan de 7 días. Los valores marcados como "supuesto" están pendientes de su validación.

export const REGLAS = {
  version: "2026-11-cdiet-1",
  // Límites por 100 g: por debajo de "bajo" = bajo; por encima de "alto" = alto; entre medias = moderado.
  limites: {
    kcal: { nombre: "Calorías", unidad: "kcal", bajo: 100, alto: 200 },
    grasa: { nombre: "Grasas", unidad: "g", bajo: 5, alto: 20 },
    saturadas: { nombre: "Grasas saturadas", unidad: "g", bajo: 1.5, alto: 5, supuesto: true },
    azucar: { nombre: "Azúcares", unidad: "g", bajo: 2, alto: 10 },
    sal: { nombre: "Sal", unidad: "g", bajo: 0.25, alto: 1 },
  },
  sodio_a_sal: 2.5,
  // Puntos por nivel y pesos de cada nutriente en la nota (supuesto: todos pesan igual).
  puntos: { bajo: 2, moderado: 1, alto: 0 },
  pesos: { kcal: 1, grasa: 1, saturadas: 1, azucar: 1, sal: 1 },
  // En alimentos frescos, la grasa, el azúcar y las calorías altas cuentan como moderadas (supuesto).
  frescos_suavizan: ["kcal", "grasa", "azucar"],
  penalizaciones: { aditivos_e_desde: 3, azucares_ocultos_desde: 2, ingredientes_mas_de: 10, resta_e: 1, resta_azucares: 1, resta_ingredientes: 0.5 },
  veredictos: [
    { desde: 7, texto: "saludable" },
    { desde: 4, texto: "con moderación" },
    { desde: 0, texto: "poco saludable" },
  ],
  plan: {
    desayuno: "30–60 min después de levantarse, con café o té sin azúcar.",
    cena: "Al menos 2–3 h antes de dormir, sin pan ni arroz la mayoría de días.",
    bebidas: "Agua durante el día. Evitar zumos, refrescos y alcohol.",
  },
};

type Nivel = "bajo" | "moderado" | "alto";
export type Extraccion = {
  name?: string; kind?: string; estimated?: boolean; fresh?: boolean;
  kcal?: number | null; fat?: number | null; sat?: number | null; sugar?: number | null;
  salt?: number | null; sodium_mg?: number | null; ingredients?: string[];
  plan?: { when?: string; why?: string }; summary?: string; warnings?: string[];
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

export function analizarIngredientes(lista: string[] = []) {
  const txt = lista.join(", ");
  const e = [...new Set((txt.match(/\bE[\s-]?\d{3,4}[a-z]?\b/gi) || []).map((s) => s.toUpperCase().replace(/[\s-]/g, "")))];
  const azucares = [...new Set(
    (txt.match(/\b[a-záéíóúñ]+osa\b|\bmiel\b|\bsiropes?\b|\bjarabes?\b[a-záéíóúñ ]{0,20}|\bmelaza\b|\bpanela\b/gi) || [])
      .map((s) => s.trim().toLowerCase())
      .filter((s) => !/celulosa|grasa/i.test(s)),
  )];
  return { total: lista.length, aditivos_e: e, azucares_ocultos: azucares };
}

export function puntuar(x: Extraccion) {
  const v: Record<string, number | null> = {
    kcal: num(x.kcal), grasa: num(x.fat), saturadas: num(x.sat), azucar: num(x.sugar), sal: num(x.salt),
  };
  if (v.sal === null && num(x.sodium_mg) !== null) v.sal = Math.round((num(x.sodium_mg)! * REGLAS.sodio_a_sal) / 10) / 100;

  const semaforo: Record<string, Nivel | null> = {};
  let pts = 0, max = 0;
  for (const [k, lim] of Object.entries(REGLAS.limites)) {
    const val = v[k];
    if (val === null) { semaforo[k] = null; continue; }
    const nivel: Nivel = val > lim.alto ? "alto" : val < lim.bajo ? "bajo" : "moderado";
    semaforo[k] = nivel;
    let p = REGLAS.puntos[nivel];
    if (x.fresh && nivel === "alto" && REGLAS.frescos_suavizan.includes(k)) p = REGLAS.puntos.moderado;
    const w = REGLAS.pesos[k as keyof typeof REGLAS.pesos];
    pts += p * w; max += 2 * w;
  }

  const ing = analizarIngredientes(x.ingredients || []);
  let nota: number | null = null;
  if (max > 0) {
    const P = REGLAS.penalizaciones;
    let s = (pts / max) * 10;
    if (ing.aditivos_e.length >= P.aditivos_e_desde) s -= P.resta_e;
    if (ing.azucares_ocultos.length >= P.azucares_ocultos_desde) s -= P.resta_azucares;
    if (ing.total > P.ingredientes_mas_de) s -= P.resta_ingredientes;
    nota = Math.round(Math.max(0, Math.min(10, s)) * 10) / 10;
  }
  const veredicto = nota === null ? "sin datos suficientes" : REGLAS.veredictos.find((r) => nota! >= r.desde)!.texto;
  return { por_100g: v, semaforo, ingredientes: ing, nota, veredicto };
}

export const PROMPT = `Eres el asistente de una app de nutrición en español. Mira la foto: puede ser la etiqueta nutricional / lista de ingredientes de un producto, o un alimento o plato sin etiqueta.

Devuelve SOLO un objeto JSON con esta forma (usa null si un dato no se puede saber):
{
 "name": "nombre corto del alimento o producto",
 "kind": "etiqueta" | "alimento",
 "estimated": true si los valores NO salen de una etiqueta visible sino de valores típicos,
 "fresh": true si es un alimento fresco o poco procesado (fruta, verdura, huevo, carne o pescado sin procesar, frutos secos naturales, legumbre, yogur natural sin azúcar),
 "kcal": kcal por 100 g, "fat": grasas g/100 g, "sat": saturadas g/100 g, "sugar": azúcares g/100 g,
 "salt": sal g/100 g (si la etiqueta solo da sodio, deja null y rellena sodium_mg), "sodium_mg": sodio mg/100 g,
 "ingredients": ["lista", "de ingredientes", "tal cual en la etiqueta, incluidos números E"] o [] si no se ven,
 "plan": {"when": "desayuno" | "cena" | "ambos" | "ocasional" | "evitar", "why": "una o dos frases explicando por qué, según el plan"},
 "summary": "una o dos frases claras y amables sobre lo saludable que es",
 "warnings": ["avisos breves, p. ej. grasas trans o hidrogenadas, edulcorantes, foto borrosa"]
}

Reglas:
- Si la etiqueta solo da valores por porción, conviértelos a 100 g.
- Si una etiqueta da kJ y kcal, usa kcal.
- Si es un plato sin etiqueta, estima valores típicos por 100 g y pon estimated: true.
- Si la foto no muestra comida, pon name: "No reconocido" y todo lo demás null.

Plan de alimentación de la persona (de su nutricionista):
- Desayuno 30–60 min tras levantarse, con café o té sin azúcar. Ejemplos: huevos revueltos con espinacas, aguacate y tomate; yogur griego natural con chía, nueces y frutos rojos; tortilla con champiñones y queso; requesón o cottage sobre pan integral con aguacate; huevos cocidos con kiwi y almendras; tostada integral con aguacate y huevo poché; yogur griego con avena, manzana y canela.
- Cena al menos 2–3 h antes de dormir, SIN pan ni arroz la mayoría de días. Ejemplos: pechuga de pollo a la plancha con ensalada; salmón o merluza al horno con brócoli y calabacín; ensalada de atún al natural; tortilla de verduras con ensalada; pavo a la plancha con judías verdes; crema de calabaza con huevo cocido; queso cottage o yogur griego salado con tomate, pepino y frutos secos.
- Bebidas: agua durante el día. Evitar zumos, refrescos y alcohol.
- Fuentes de hidratos (cereales, pan, arroz, pasta, patata, batata, legumbres, azúcares): mejor en el desayuno, no en la cena.
- Azúcares (azúcar, miel, mermelada, golosinas): ocasional o evitar.`;
