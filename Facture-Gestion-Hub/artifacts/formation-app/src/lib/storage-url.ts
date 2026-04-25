/**
 * Ajoute `inline=1` pour les liens directs (téléchargement / nouvel onglet classique).
 */
export function storageUrlForPreview(url: string): string {
  try {
    const u = new URL(
      url,
      typeof window !== "undefined" ? window.location.href : "http://localhost/",
    );
    u.searchParams.set("inline", "1");
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return u.href;
    }
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url.includes("?") ? `${url}&inline=1` : `${url}?inline=1`;
  }
}

/** URL absolue pour fetch (cookies) — tient compte de `import.meta.env.BASE_URL` (Vite). */
export function resolveStorageFetchUrl(url: string): string {
  if (typeof window === "undefined") return url;
  const { origin } = window.location;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const withBase = (pathAndQuery: string) => {
    let p = pathAndQuery;
    if (!p.startsWith("/")) p = `/${p}`;
    if (p.startsWith("/api") && base && !p.startsWith(`${base}/`)) p = `${base}${p}`;
    return `${origin}${p}`;
  };
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (u.origin === origin) return url;
      return withBase(`${u.pathname}${u.search}${u.hash}`);
    } catch {
      return url;
    }
  }
  return withBase(url);
}

function buildFetchCandidates(url: string): string[] {
  const out = new Set<string>();
  const resolved = resolveStorageFetchUrl(url);
  out.add(resolved);
  out.add(storageUrlForPreview(resolved));

  // Backward-compat: some records may store `/storage/...` instead of `/api/storage/...`.
  if (resolved.includes("/storage/") && !resolved.includes("/api/storage/")) {
    out.add(resolved.replace("/storage/", "/api/storage/"));
  }
  if (resolved.includes("/api/storage/")) {
    out.add(resolved.replace("/api/storage/", "/storage/"));
  }

  // Normalize accidental duplicate `/api/api/` segments.
  if (resolved.includes("/api/api/")) {
    out.add(resolved.replace("/api/api/", "/api/"));
  }
  return [...out];
}

/**
 * Télécharge le fichier via l’API (cookies de session) et expose un blob: URL pour aperçu en modal.
 */
export async function fetchStorageBlobForPreview(url: string): Promise<{ blobUrl: string; mime: string }> {
  const candidates = buildFetchCandidates(url);
  let lastStatus = 0;
  for (const abs of candidates) {
    const res = await fetch(abs, { credentials: "include", cache: "no-store" });
    if (!res.ok) {
      lastStatus = res.status;
      if (res.status === 401) {
        throw new Error("Session expirée — reconnectez-vous");
      }
      // try next candidate on 404/400-like URL issues
      continue;
    }
    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, mime };
  }
  throw new Error(`Impossible de charger le fichier (${lastStatus || 404})`);
}
