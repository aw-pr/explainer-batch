// Values derived from the stored artefact and never stored themselves, so
// explainer-batch and promo-flow produce the same strings.

export interface BylineSource {
  authors: ReadonlyArray<{ family: string }>;
  year?: number | null;
}

/** `Alenezi (2026)`, `Hu and Li (2025)`, `Hu et al. (2025)`; the names alone with no year. */
export function byline(reference: BylineSource): string {
  const families = reference.authors.map((a) => a.family);
  const names =
    families.length === 1 ? families[0]
    : families.length === 2 ? `${families[0]} and ${families[1]}`
    : `${families[0]} et al.`;
  return reference.year == null ? names : `${names} (${reference.year})`;
}

export function eyebrow(reference: BylineSource): string {
  return `Research Explainer · ${byline(reference)}`;
}
