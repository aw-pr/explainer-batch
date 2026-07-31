/**
 * Versioned schema for the explainer JSON sidecar.
 *
 * This file is the canonical type definition shared between explainer-batch
 * (which writes the JSON) and the consuming website repo (which reads it for
 * native rendering). Point WEBSITE_REPO at that repo to enable the handoff.
 *
 * Version history:
 *   1 — initial schema (2026-04-11)
 *
 * Design goals:
 *   - All fields optional where the LLM may legitimately omit them
 *   - `sections` array is open-ended to accommodate future prompt evolution
 *   - `version` field allows consumers to handle schema migrations gracefully
 */

export interface ExplainerJson {
  /** Schema version — bump when structure changes in a breaking way */
  version: 1;

  metadata: {
    /** Full <title> tag content, e.g. "Causal Reasoning in LLMs: Chi et al. (2024)" */
    title: string;
    /** Eyebrow line, e.g. "Research Explainer · Chi et al. (2024)" */
    eyebrow: string;
    /** ISO date the explainer was created, e.g. "2026-04-11" */
    date_created: string;
    /** Filename stem without extension, e.g. "chi_causal-reasoning-in-llms_explainer" */
    filename_slug: string;
    /**
     * Model ID that generated this explainer, e.g. "claude-fable-5" or
     * "gpt-5.6-terra". The version is part of the ID. Absent on artifacts
     * written before this field existed; the renderer maps it to a display name.
     */
    model?: string;
    /**
     * How the generating request was dispatched: "batch" (provider batch API,
     * eligible for the batch discount) or "sync" (synchronous single request,
     * including the codex/OAuth subscription routes). Rendered alongside the
     * model name in the hero tag. Absent on older artifacts.
     */
    run_mode?: 'sync' | 'batch';
  };

  hero: {
    /** Plain-text headline (HTML stripped) */
    headline: string;
    /**
     * Raw inner HTML of the <h1> element, preserving <span> highlights.
     * Use dangerouslySetInnerHTML in the renderer; content is from a controlled generator.
     */
    headline_html: string;
    /** Hero subtitle text */
    subtitle: string;
    /** "Published Month Year" line if present in the hero section */
    publication_date?: string;
  };

  /**
   * The block that appears directly below the hero.
   * Either a grid of lead-in pills or a standalone takeaway box.
   */
  top_block:
    | { kind: 'pills'; pills: ExplainerPill[] }
    | { kind: 'takeaway'; label: string; body: string };

  /** Chart blocks — absent if the explainer has no empirical data worth visualising */
  charts?: ExplainerChart[];
  /**
   * Legacy single-chart field retained for backward compatibility.
   * New outputs should prefer `charts`.
   */
  chart?: ExplainerChart;

  /**
   * Optional data-native recreation of a results figure from the paper,
   * produced by the post-batch figure-data pass (never by the batch model).
   * Present only when the underlying data was recoverable at acceptable
   * provenance; otherwise the pipeline falls back to the cropped `image`.
   * Consumers that cannot render ECharts yet should ignore this field and
   * keep rendering `image` / `charts`.
   */
  recreated_figure?: ExplainerRecreatedFigure;

  /**
   * Optional conceptual figure lifted from the paper — visual abstract,
   * architecture overview, or taxonomy graphic that cannot be faithfully
   * recreated in Chart.js. The model picks at most one and names it
   * (e.g. "Figure 1"); a deterministic post-step rasterises the page
   * from the source PDF and fills `src` with a data URL.
   */
  image?: ExplainerImage;

  /** Ordered prose sections making up the article body */
  sections: ExplainerSection[];

  /** Takeaway box at the end of the article (distinct from a top_block takeaway) */
  end_takeaway?: {
    label: string;
    body: string;
  };

  /**
   * Reference block entries as raw HTML strings.
   * Each string may contain <a> tags with arXiv/DOI links.
   * Render with an anchor-allowlist sanitiser.
   */
  references: string[];
}

export interface ExplainerPill {
  /**
   * The prominent lead token, usually a statistic such as "<70%" or "3,461",
   * but it may also be a compact concept label such as "Agentic AI".
   * May include HTML entities.
   */
  number: string;
  /** Descriptive text accompanying the lead token */
  description: string;
  /** CSS colour for the pill accent (border-top and number colour), e.g. "#ff6b6b" */
  accent_color: string;
}

export interface ExplainerChart {
  /** Chart card title, e.g. "Vanilla accuracy across benchmarks" */
  title: string;
  /** Caption below the chart */
  caption: string;
  /**
   * Parsed Chart.js config object.
   * Null if the config contains function callbacks (e.g. ticks.callback).
   * Use config_raw in that case.
   */
  config_json: unknown | null;
  /**
   * Raw JavaScript object literal string from the <script> block.
   * Deserialise with: new Function("return " + config_raw)()
   * Safe because this content comes from the controlled explainer-batch generator.
   */
  config_raw: string;
}

/** How the recreated figure's numbers were obtained, most to least trusted. */
export type RecreatedDataProvenance = 'supplied' | 'paper_exact' | 'figure_estimated';

export interface RecreatedSeries {
  /** Legend name, e.g. a system or condition. */
  name: string;
  /**
   * Y values aligned to `x.values` by index (null for a gap). Ignored for
   * scatter series, which carry explicit `points` instead.
   */
  values?: Array<number | null>;
  /** [x, y] pairs for scatter-type figures. */
  points?: Array<[number, number]>;
  /** Per-series trust: exact numbers vs values read off the figure. */
  provenance: 'exact' | 'estimated';
  /** Where the numbers came from, e.g. "Table 2, row 3" or "value labels printed on bars". */
  source?: string;
}

/**
 * Data-native recreation of a source figure. The neutral fields (chart_type,
 * x, y, series) are the canonical data; `echarts_option` is derived from them
 * deterministically by the generator and can be re-derived at any time. The
 * model never authors the ECharts option directly.
 */
export interface ExplainerRecreatedFigure {
  /** Label of the recreated source figure, e.g. "Figure 3". */
  source_figure: string;
  /** Chart card title. */
  title: string;
  /**
   * Caption below the chart. When data_provenance is "figure_estimated" the
   * generator appends an approximation notice; keep it when re-rendering.
   */
  caption: string;
  chart_type: 'bar' | 'grouped_bar' | 'stacked_bar' | 'line' | 'scatter';
  /** X axis: category labels or numeric positions shared by non-scatter series. */
  x: { label: string; unit?: string; values: Array<string | number> };
  /** Y axis metadata; values live in each series. */
  y: { label: string; unit?: string };
  series: RecreatedSeries[];
  data_provenance: RecreatedDataProvenance;
  /** Apache ECharts option object generated from the neutral fields above. */
  echarts_option: unknown;
  /** Diagnostics from the extraction pass. */
  extraction?: {
    provider?: string;
    route?: string;
    /** True when the render-and-compare verification pass confirmed the data. */
    verified?: boolean;
  };
}

export interface ExplainerImage {
  /**
   * Label of the source figure in the paper, e.g. "Figure 1".
   * Used by the post-step to locate the page to rasterise.
   */
  source_figure: string;
  /** Caption shown below the image, e.g. "Zandieh et al. (2026), Figure 1." */
  caption: string;
  /** Short alt text for accessibility. Falls back to caption if omitted. */
  alt_text?: string;
  /**
   * Image source the renderer puts in `<img src="…">`. Populated by the
   * post-extraction step as a `data:image/jpeg;base64,…` data URL (or PNG
   * fallback if `sips` is unavailable). Absent when extraction failed or
   * before post-processing ran.
   */
  src?: string;
}

export interface ExplainerSection {
  /** Small-caps section label, e.g. "The core question" */
  label: string;
  /** Paragraph text, HTML stripped */
  paragraphs: string[];
  /**
   * Raw inner HTML of each paragraph — present when the paragraph contains
   * inline markup (<strong>, <em>, <a>). Render with an allowlist sanitiser.
   * Parallel array with `paragraphs`; index i of paragraphs_html corresponds
   * to index i of paragraphs.
   */
  paragraphs_html?: string[];
  /**
   * Structured list content for genuinely list-shaped material such as
   * ordered frameworks, named steps, or explicit taxonomies.
   */
  list?: ExplainerSectionList;
  /**
   * Structured tabular content. Preferred over a bar chart when the source
   * material is a grid of values (e.g. metric × system) that a reader scans
   * rather than compares by magnitude. See ExplainerSectionTable.
   */
  table?: ExplainerSectionTable;
}

export interface ExplainerSectionList {
  /** Ordered when the source material is a sequence, otherwise unordered */
  ordered: boolean;
  /** Optional rendering hint for stronger editorial treatment */
  style?: 'steps' | 'list';
  /** Optional list intro displayed above the items */
  intro?: string;
  /** Optional rich HTML version of intro with inline markup */
  intro_html?: string;
  /** List items in source order */
  items: ExplainerSectionListItem[];
}

export interface ExplainerSectionListItem {
  /** Optional inline item heading, e.g. "Decision 1" */
  label?: string;
  /** Main item body text */
  body: string;
  /** Optional HTML version of the item body */
  body_html?: string;
}

export interface ExplainerSectionTable {
  /** Optional caption shown below the table, e.g. "Hu et al. (2025), Figure 10." */
  caption?: string;
  /** Column headers in display order. First column is usually the row label. */
  columns: string[];
  /**
   * Rows in source order. Each row is an array of plain-text cell values
   * aligned to `columns` by index. Cells are strings so units and ranges
   * ("32.3", "16-64%", "OOM") render verbatim.
   */
  rows: string[][];
  /**
   * Optional per-column text alignment, aligned to `columns` by index.
   * Default: first column left, remaining columns right (numeric).
   */
  align?: Array<'left' | 'right' | 'center'>;
}
