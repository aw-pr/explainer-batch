// The v2 explainer contract: one zod source for what the model emits
// (ModelOutputV2) and what is stored (ExplainerV2).
//
// Each block is declared once as a function of a composition `c`. On the wire
// `c.opt` makes a property required-but-nullable (the strict structured-output
// dialects cannot express an absent key) and `c.edit` applies an editorial
// bound; in the stored artefact `c.opt` makes a property optional and never
// nullable, and `c.edit` is the identity, so a curated artefact outside an
// editorial bound still parses. Structural rules hold in both.
//
// Refinements are runtime checks only; the generated JSON Schema dialects
// carry the structure and these validators carry structure plus content rules.
import { z } from 'zod';
import { isInlineText, isPlainText } from './inline';

export const CONTRACT_REVISION = 1;

type Bound = { min?: number; max?: number };
type Editable = z.ZodString | z.ZodArray<z.ZodType>;
type Opt<W extends boolean, T extends z.ZodType> = W extends true ? z.ZodNullable<T> : z.ZodOptional<T>;

interface Comp<W extends boolean> {
  wire: W;
  opt<T extends z.ZodType>(s: T): Opt<W, T>;
  edit<T extends Editable>(s: T, b: Bound): T;
}

function bounded<T extends Editable>(s: T, b: Bound): T {
  let out = s as z.ZodString;
  if (b.min !== undefined) out = out.min(b.min);
  if (b.max !== undefined) out = out.max(b.max);
  return out as unknown as T;
}

const onWire: Comp<true> = {
  wire: true,
  opt: (s) => s.nullable() as Opt<true, typeof s>,
  edit: bounded,
};

const stored: Comp<false> = {
  wire: false,
  opt: (s) => s.optional() as Opt<false, typeof s>,
  edit: (s) => s,
};

type Issue = { path: (string | number)[]; message: string };
function report(ctx: z.RefinementCtx, issues: Issue[]): void {
  for (const i of issues) ctx.addIssue({ code: 'custom', path: i.path, message: i.message });
}

// ---------------------------------------------------------------- text types

export const PlainText = z
  .string()
  .min(1)
  .refine(isPlainText, 'must be plain text: no HTML tags and no HTML entities');

export const TableCell = z
  .string()
  .refine(s => s === '' || isPlainText(s), 'must be empty or plain text: no HTML tags and no HTML entities');

export const InlineText = z
  .string()
  .min(1)
  .refine(isInlineText, 'must be canonical inline markup: only em, strong, code, sub, sup and a href, text escaped as &amp; &lt; &gt; &quot;');

const HttpUrl = z.string().regex(/^https?:\/\/\S+$/, 'must be an http(s) URL');
const Page = z.int().min(1);

// ---------------------------------------------------------------- hero

const heroShape = <W extends boolean>(c: Comp<W>) => ({
  title: c.edit(PlainText, { max: 80 }).describe('Short article title, used for the page title, cards and the slug.'),
  headline: c.edit(PlainText, { max: 160 }).describe('One-sentence hero headline stating the main finding.'),
  emphasis: c.opt(PlainText).describe('A phrase copied exactly from the headline to highlight, or null for none.'),
  subtitle: c.edit(PlainText, { max: 320 }).describe('One or two sentences expanding the headline.'),
});

function emphasisRule(hero: { headline: string; emphasis?: string | null }, ctx: z.RefinementCtx): void {
  if (hero.emphasis != null && !hero.headline.includes(hero.emphasis)) {
    report(ctx, [{ path: ['emphasis'], message: 'emphasis must be a substring of headline' }]);
  }
}

// ---------------------------------------------------------------- top block

const pill = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    lead: c.edit(PlainText, { max: 24 }).describe('The pill\'s short lead: a number with its unit, or a two or three word phrase.'),
    text: c.edit(PlainText, { max: 160 }).describe('One sentence saying what the lead means.'),
  });

const topBlock = <W extends boolean>(c: Comp<W>) =>
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('pills').describe('Key-figure pills under the hero.'),
      pills: c.edit(z.array(pill(c)).min(1), { min: 2, max: 6 }).describe('Two to six key figures or ideas from the paper.'),
    }),
    z.strictObject({
      kind: z.literal('takeaway').describe('A single takeaway block under the hero.'),
      label: PlainText.describe('Short label for the takeaway, such as "In short".'),
      body: InlineText.describe('The takeaway itself, one to three sentences.'),
    }),
  ]).describe('The block under the hero: pills, or a takeaway.');

// ---------------------------------------------------------------- sections

const sourceRef = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    ref: PlainText.describe('The table as printed in the paper ("Table 2"), or for a web page the section heading.'),
    page: c.opt(Page).describe('The PDF page the table sits on, or null when unknown or not a PDF.'),
  });

const list = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    ordered: z.boolean().describe('True for a sequence whose order matters, false otherwise.'),
    intro: c.opt(InlineText).describe('One sentence introducing the list, or null.'),
    items: z
      .array(
        z.strictObject({
          label: c.opt(PlainText).describe('Short bold label for the item, or null.'),
          body: InlineText.describe('The item text.'),
        }),
      )
      .min(1)
      .describe('The list items.'),
  });

const table = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    caption: c.opt(PlainText).describe('What the table shows, without a source tag, or null.'),
    columns: z.array(PlainText).min(2).describe('Column headings, at least two.'),
    rows: z.array(z.array(TableCell).min(1)).min(1).describe('Table rows, each a list of cell strings in column order.'),
    source: c.opt(sourceRef(c)).describe('Where the table comes from in the paper, or null.'),
  });

const section = <W extends boolean>(c: Comp<W>) =>
  z
    .strictObject({
      label: PlainText.describe('Section heading.'),
      paragraphs: z.array(InlineText).describe('The section prose, one string per paragraph.'),
      list: c.opt(list(c)).describe('An optional list block, or null.'),
      table: c.opt(table(c)).describe('An optional table block, or null.'),
    })
    .superRefine((s, ctx) => {
      if (s.paragraphs.length === 0 && s.list == null && s.table == null) {
        report(ctx, [{ path: ['paragraphs'], message: 'a section needs paragraphs, a list or a table' }]);
      }
    });

// ---------------------------------------------------------------- charts

export const WIRE_SOURCE_KINDS = ['table', 'text'] as const;
export const STORED_SOURCE_KINDS = ['table', 'text', 'value_labels', 'supplied', 'legacy'] as const;
type SourceKinds = readonly [string, ...string[]];

const seriesSource = <W extends boolean, K extends SourceKinds>(c: Comp<W>, kinds: K) =>
  z.strictObject({
    kind: z.enum(kinds).describe('table: the values come from a printed table; text: from a sentence in the paper.'),
    ref: PlainText.describe('For table, the table as printed ("Table 2"); for text, a verbatim fragment of at most 160 characters containing the values.'),
    page: c.opt(Page).describe('The PDF page of the source, or null.'),
  });

interface ChartLike {
  kind: string;
  x: { type: string; unit?: string | null; values: unknown[] };
  y: { scale: string; unit?: string | null };
  series: { values?: unknown[] | null; points?: unknown[] | null }[];
}

function chartRule(wire: boolean) {
  return (chart: ChartLike, ctx: z.RefinementCtx): void => {
    const issues: Issue[] = [];
    if (chart.kind === 'stacked_bar' && chart.y.scale === 'log') {
      issues.push({ path: ['y', 'scale'], message: 'stacked_bar cannot use a log y axis' });
    }
    chart.series.forEach((s, i) => {
      if (chart.kind === 'scatter') {
        if (s.points == null || s.points.length === 0) {
          issues.push({ path: ['series', i, 'points'], message: 'a scatter series needs points' });
        }
      } else if (s.values == null || s.values.length !== chart.x.values.length) {
        issues.push({
          path: ['series', i, 'values'],
          message: `a ${chart.kind} series needs one value per x.values entry (${chart.x.values.length})`,
        });
      }
    });
    if (wire) {
      if (chart.y.unit == null) issues.push({ path: ['y', 'unit'], message: 'a numeric axis needs a unit' });
      if (chart.x.type !== 'category' && chart.x.unit == null) {
        issues.push({ path: ['x', 'unit'], message: 'a numeric axis needs a unit' });
      }
    }
    report(ctx, issues);
  };
}

const chart = <W extends boolean, K extends SourceKinds>(c: Comp<W>, kinds: K) =>
  z
    .strictObject({
      kind: z.enum(['bar', 'stacked_bar', 'line', 'scatter']).describe('The chart type.'),
      title: PlainText.describe('Chart title.'),
      caption: PlainText.describe('One sentence saying what the chart shows, without a source tag.'),
      x: z
        .strictObject({
          label: PlainText.describe('Axis label.'),
          unit: c.opt(PlainText).describe('Axis unit; required when the axis is numeric, otherwise null.'),
          type: z.enum(['category', 'linear', 'log']).describe('category for labels, linear or log for numbers.'),
          values: z
            .array(z.union([PlainText, z.number()]))
            .describe('The x positions, aligned by index with each non-scatter series; may be empty for scatter.'),
        })
        .describe('The x axis.'),
      y: z
        .strictObject({
          label: PlainText.describe('Axis label.'),
          unit: c.opt(PlainText).describe('Axis unit, such as "%" or "ms".'),
          scale: z.enum(['linear', 'log']).describe('The y scale.'),
        })
        .describe('The y axis.'),
      series: z
        .array(
          z.strictObject({
            name: PlainText.describe('Series name, shown in the legend.'),
            values: c.opt(z.array(z.number().nullable())).describe('One value per x.values entry, null for a gap; null for a scatter series.'),
            points: c.opt(z.array(z.strictObject({ x: z.number(), y: z.number() }))).describe('The points of a scatter series; null otherwise.'),
            source: seriesSource(c, kinds).describe('Where the series values are stated in the paper.'),
          }),
        )
        .min(1)
        .describe('The data series, at least one.'),
    })
    .superRefine(chartRule(c.wire));

// ---------------------------------------------------------------- figure, takeaway, citation

const figureRequest = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    label: PlainText.describe('The figure as labelled in the paper, such as "Figure 3".'),
    why: c.edit(PlainText, { max: 240 }).describe('Why this figure best illustrates the article.'),
  });

const takeaway = z.strictObject({
  label: PlainText.describe('Short label, such as "Bottom line".'),
  body: InlineText.describe('The closing takeaway, one to three sentences.'),
});

const author = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    family: PlainText.describe('Family name.'),
    given: c.opt(PlainText).describe('Given names or initials, or null.'),
  });

const citation = <W extends boolean>(c: Comp<W>) =>
  z.strictObject({
    authors: z.array(author(c)).min(1).describe('The authors in the order the paper lists them.'),
    year: c.opt(z.int().min(1)).describe('Publication year, or null when the paper does not state one.'),
    title: PlainText.describe('The paper\'s full title.'),
    venue: c.opt(PlainText).describe('Journal, conference or archive, or null.'),
    url: c.opt(HttpUrl).describe('A canonical http(s) URL for the paper, or null.'),
  });

function takeawayRule(wire: boolean) {
  return (o: { top_block: { kind: string }; end_takeaway?: unknown }, ctx: z.RefinementCtx): void => {
    if (o.top_block.kind === 'takeaway' && o.end_takeaway != null) {
      report(ctx, [{ path: ['end_takeaway'], message: 'end_takeaway must be absent when top_block is a takeaway' }]);
    } else if (wire && o.top_block.kind === 'pills' && o.end_takeaway == null) {
      report(ctx, [{ path: ['end_takeaway'], message: 'a pills top block needs an end_takeaway' }]);
    }
  };
}

// ---------------------------------------------------------------- what the model emits

export const ModelOutputV2 = z
  .strictObject({
    hero: z.strictObject(heroShape(onWire)).superRefine(emphasisRule).describe('The article hero.'),
    top_block: topBlock(onWire),
    sections: onWire
      .edit(z.array(section(onWire)).min(1), { min: 2, max: 5 })
      .describe('Two to five article sections.'),
    charts: z.array(chart(onWire, WIRE_SOURCE_KINDS)).max(1).describe('At most one chart, built only from values the paper states.'),
    figure_request: onWire.opt(figureRequest(onWire)).describe('The paper figure to show as the lead image, or null.'),
    end_takeaway: onWire.opt(takeaway).describe('Closing takeaway: required with pills, null with a takeaway top block.'),
    citation: onWire.opt(citation(onWire)).describe('The paper\'s citation read from its front matter, or null when told the citation is known.'),
  })
  .superRefine(takeawayRule(true))
  .describe('A research explainer article.');

const citationRequired = ModelOutputV2.superRefine((o, ctx) => {
  if (o.citation === null) {
    report(ctx, [{ path: ['citation'], message: 'no reference was detected, so the citation must be emitted' }]);
  }
});

/** The wire validator for one request: the citation is required unless detection already supplied it. */
export function modelOutputValidator(ctx: { citationKnown: boolean }): typeof ModelOutputV2 {
  return ctx.citationKnown ? ModelOutputV2 : citationRequired;
}

// ---------------------------------------------------------------- what is stored

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const IsoMonthOrDay = z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/, 'must be YYYY-MM or YYYY-MM-DD');
export const SLUG = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9_-]*_explainer$/;
const ASSET_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)?$/;

const metadata = z.strictObject({
  date_created: IsoDay.describe('The submit date.'),
  slug: z.string().regex(SLUG, 'must be YYYY-MM-DD_<safe name>_explainer').describe('The file name without extension.'),
  model: z.string().min(1).describe('The model id, or unknown.'),
  provider: z.string().min(1).describe('claude, openai, or unknown.'),
  route: z.enum(['batch', 'sync', 'unknown']).describe('How the request was run.'),
  source: stored
    .opt(
      z.strictObject({
        kind: z.enum(['pdf', 'url']),
        ref: z.string().min(1).describe('The URL, or the PDF basename.'),
      }),
    )
    .describe('The input the article was written from; absent on a migrated artefact.'),
  contract_revision: z.int().min(1).describe('CONTRACT_REVISION at the time of writing.'),
  migrated_from: stored.opt(z.literal(1)).describe('Present only on an artefact written by migrateV1().'),
  quality: z
    .strictObject({
      issues: z.array(z.string()).describe('Validator messages that survived repair, including editorial bounds.'),
      dropped: z.array(z.string()).describe('Items code removed: stripped tags, unknown keys, thin charts, an unused citation.'),
    })
    .describe('The review record.'),
});

const leadFigure = z.strictObject({
  label: PlainText.describe('The figure label, such as "Figure 3".'),
  caption: PlainText.describe('The figure caption.'),
  alt_text: PlainText.describe('Alt text for the image.'),
  asset: z
    .string()
    .regex(ASSET_PATH, 'must be a relative POSIX path of one or two segments')
    .describe('The image path relative to the artefact\'s directory.'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256').describe('Hash of the asset bytes.'),
  width: stored.opt(z.int().min(1)).describe('Pixel width of a raster asset.'),
  height: stored.opt(z.int().min(1)).describe('Pixel height of a raster asset.'),
  page: stored.opt(Page).describe('The PDF page the figure came from.'),
  provenance: z
    .enum(['arxiv-source', 'pdf-embedded', 'pdf-vector-crop', 'dom-asset', 'vlm-crop', 'legacy'])
    .describe('How the figure was obtained.'),
});

const reference = citation(stored).extend({
  origin: z.enum(['detected', 'model', 'legacy']).describe('detected by the harness, copied from the model\'s citation, or migrated.'),
});

export const ExplainerV2 = z
  .strictObject({
    version: z.literal(2),
    metadata,
    hero: z
      .strictObject({
        ...heroShape(stored),
        publication_date: stored.opt(IsoMonthOrDay).describe('When the paper was published, if known.'),
      })
      .superRefine(emphasisRule)
      .describe('The article hero.'),
    top_block: topBlock(stored),
    sections: z.array(section(stored)).min(1).describe('The article sections.'),
    charts: z.array(chart(stored, STORED_SOURCE_KINDS)).max(3).describe('Charts; one when native, up to three when migrated.'),
    figure_request: stored.opt(figureRequest(stored)).describe('The figure the model asked for, kept for reextract.'),
    lead_figure: stored.opt(leadFigure).describe('The lead image, resolved and stored as a sidecar asset.'),
    end_takeaway: stored.opt(takeaway).describe('Closing takeaway.'),
    references: z.array(reference).length(1).describe('The paper\'s own reference, exactly one.'),
  })
  .superRefine(takeawayRule(false))
  .describe('A stored v2 research explainer.');

export type ModelOutputV2 = z.infer<typeof ModelOutputV2>;
export type ExplainerV2 = z.infer<typeof ExplainerV2>;
export type Chart = ExplainerV2['charts'][number];
export type Reference = ExplainerV2['references'][number];
