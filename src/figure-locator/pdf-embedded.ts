import { buildCaptionIndex, type CaptionEntry } from './captions';
import { imageBoxes, type Rect } from './geometry';
import type { LocatedFigure } from './index';
import { labelsEqual } from './label';
import { cropPdfRegion, embeddedImagePpi, renderDpiFor } from './pdf-crop';
import { pageBlocks, type PageBlock } from './region';
import type { FigureRequest } from './request';

const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) > Math.max(a0, b0);

/** Native image bounds are safe only when the entire figure has one caption-adjacent image. */
export function adjacentEmbeddedBox(caption: CaptionEntry, images: Rect[], blocks: PageBlock[]): Rect | null {
  if (caption.key.panel || caption.continued) return null;
  const c = caption.box;
  const candidates = images.filter(b => b.x1 - b.x0 >= Math.max(60, (c.xMax - c.xMin) * 0.6) &&
    b.y1 - b.y0 >= 40 && b.y1 <= c.yMin && c.yMin - b.y1 <= 24 &&
    b.x0 <= (c.xMin + c.xMax) / 2 && b.x1 >= (c.xMin + c.xMax) / 2);
  if (candidates.length !== 1 || images.some(b => b.y0 >= c.yMax && b.y0 - c.yMax <= 24 &&
    overlaps(b.x0, b.x1, c.xMin, c.xMax))) return null;
  const box = candidates[0];
  // A second image could be another panel; text within the image span could be labels outside its asset.
  if (images.some(b => b !== box && overlaps(b.x0, b.x1, c.xMin, c.xMax) &&
    overlaps(b.y0, b.y1, box.y0, c.yMin))) return null;
  if (blocks.some(b => overlaps(b.box.x0, b.box.x1, Math.min(box.x0, c.xMin), Math.max(box.x1, c.xMax)) &&
    overlaps(b.box.y0, b.box.y1, box.y0, c.yMin))) return null;
  return box;
}

/** Conservative local fast path; every uncertain layout stays on the existing VLM path. */
export function locateEmbeddedFigure(request: FigureRequest): LocatedFigure | null {
  if (!request.label || request.label.panel || request.forceRegionCrop || !request.source.pdfPath) return null;
  const pdfPath = request.source.pdfPath;
  try {
    const captions = buildCaptionIndex(pdfPath).filter(c => labelsEqual(c.key, request.label!));
    if (captions.length !== 1) return null;
    const caption = captions[0];
    const box = adjacentEmbeddedBox(caption, imageBoxes(pdfPath, caption.page), pageBlocks(pdfPath, caption.page));
    if (!box) return null;
    const crop = cropPdfRegion(pdfPath, caption.page, box, renderDpiFor('pdf-embedded', embeddedImagePpi(pdfPath, caption.page)));
    if (!crop) return null;
    return {
      ok: true, label: caption.key, captionText: caption.text, page: caption.page, regionPt: box,
      bytes: crop.bytes, ext: 'jpg', width: crop.width, height: crop.height,
      provenance: 'pdf-embedded', calls: { picker: 0, verify: 0 },
      notes: request.pageHint !== undefined && request.pageHint !== caption.page ? ['page-hint-ignored'] : [],
    };
  } catch {
    return null;
  }
}
