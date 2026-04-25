/**
 * Les formations (= prestations) sont gérées par le catalogue API (`/api/catalogs`).
 * `DEFAULT_FORMATION_NAMES` sert de liste de référence pour le seed serveur.
 */
import { DEFAULT_FORMATION_NAMES } from "@workspace/formations";

export { DEFAULT_FORMATION_NAMES };

/** @deprecated Utiliser le catalogue API — conservé pour imports existants. */
export const REFERENCE_PRESTATIONS: readonly string[] = DEFAULT_FORMATION_NAMES;

export function normalizePrestationKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mergePrestationLabels(...groups: (readonly string[])[]): string[] {
  const m = new Map<string, string>();
  for (const group of groups) {
    for (const s of group) {
      const t = s.replace(/\s+/g, " ").trim();
      if (t.length < 2) continue;
      const k = normalizePrestationKey(t);
      if (!m.has(k)) m.set(k, t);
    }
  }
  return [...m.values()].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}
