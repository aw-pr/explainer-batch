import { sniffImageType, type AssetExt } from './asset';
import { buildCaptionIndex, selectCaption } from './captions';
import type { Rect } from './geometry';
import type { LabelKey } from './label';
import { cropPdfRegion, embeddedImagePpi, renderDpiFor } from './pdf-crop';
import { locateRegion } from './region';
import type { FigureRequest } from './request';

export interface LocatedFigure {
  ok: true;
  label: LabelKey;
  captionText?: string;
  page?: number;
  regionPt?: Rect;
  bytes: Buffer;
  ext: AssetExt;
  width?: number;
  height?: number;
  provenance: 'arxiv-source' | 'pdf-embedded' | 'pdf-vector-crop' | 'dom-asset' | 'vlm-crop';
  calls: { picker: 0 | 1; verify: 0 | 1 };
  notes: string[];
}

export interface NoFigure {
  ok: false;
  reason: 'no-request' | 'source-unavailable' | 'label-not-found' | 'pin-not-found' | 'region-too-small';
  labels?: string[];
  notes: string[];
}

export async function locateFigure(request: FigureRequest): Promise<LocatedFigure | NoFigure> {
  if (!request.label) return { ok: false, reason: 'no-request', notes: [] };
  const pdfPath = request.source.pdfPath;
  if (!pdfPath) return { ok: false, reason: 'source-unavailable', notes: [] };
  let notes: string[] = [];
  try {
    const index = buildCaptionIndex(pdfPath);
    const region = locateRegion(pdfPath, request.label, {
      pageHint: request.pageHint, forceRegionCrop: request.forceRegionCrop, index,
    });
    if (!region.ok) {
      return { ...region, reason: region.reason === 'label-not-found' && request.pinned ? 'pin-not-found' : region.reason };
    }
    notes = [...region.notes];
    if (region.ambiguous) notes.push('ambiguous-region: union region taken');
    const caption = selectCaption(index, request.label, request.pageHint);
    if (!caption.ok) return { ok: false, reason: 'source-unavailable', notes };
    const ppi = region.provenance === 'pdf-embedded' ? embeddedImagePpi(pdfPath, region.page) : null;
    const crop = cropPdfRegion(pdfPath, region.page, region.cropBox, renderDpiFor(region.provenance, ppi));
    const ext = crop && sniffImageType(crop.bytes);
    if (!crop || !ext) return { ok: false, reason: 'source-unavailable', notes };
    return {
      ok: true,
      label: { ...caption.entry.key, ...(request.label.panel && { panel: request.label.panel }) },
      captionText: caption.entry.text,
      page: region.page,
      regionPt: region.cropBox,
      bytes: crop.bytes,
      ext,
      width: crop.width,
      height: crop.height,
      provenance: region.provenance,
      calls: { picker: 0, verify: 0 },
      notes,
    };
  } catch (error) {
    return { ok: false, reason: 'source-unavailable', notes: [...notes, error instanceof Error ? error.message : String(error)] };
  }
}
