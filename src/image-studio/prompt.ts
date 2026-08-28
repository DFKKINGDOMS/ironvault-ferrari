import type { StudioBackground, StudioWatermarkStatus } from './types.js';

const PARTQUILL_INTEGRITY_PROMPT = `Create a premium ecommerce catalog image from this exact automotive-part source.

Preserve the exact product geometry, orientation, holes, openings, fasteners, connectors, labels, serial numbers, material, finish, wear, damage, proportions, camera angle, quantity, and piece count. Do not invent, remove, reshape, polish away, repair, beautify, or alter any physical product feature. Do not merge views or create a collage.

Keep the complete item inside the frame with comfortable even margins and sharp catalog-quality edges. Preserve accurate color, genuine markings, and realistic surface texture. Do not add text, props, stands, hands, packaging, badges, scenery, replacement logos, or extra objects.

Accuracy is mandatory. If a faithful edit is not possible, do not fabricate a different part.`;

export function buildStudioPrompt(background: StudioBackground, watermarkStatus: StudioWatermarkStatus): string {
  const backgroundRule =
    background === 'TRANSPARENT'
      ? 'Isolate the complete product on a clean transparent background. Do not leave a gray halo, dirty edge, gradient, vignette, floor, cast shadow, contact shadow, or drop shadow.'
      : background === 'SOFT_GRAY'
        ? 'Isolate the complete product on a uniform very-light neutral gray (#F1F1F1) studio background with no gradient, vignette, floor, cast shadow, contact shadow, or drop shadow.'
        : 'Isolate the complete product on a PURE SOLID WHITE (#FFFFFF) background. No cast shadow, contact shadow, drop shadow, gray halo, floor shading, gradient, vignette, or off-white background.';

  const watermarkRule =
    watermarkStatus === 'OWNED_OR_AUTHORIZED'
      ? 'The seller has confirmed ownership or written authorization for the photograph. Remove seller-authorized background watermarking, repeating background text, corner branding, borders, and unrelated background elements. Never remove a label, logo, part number, serial number, stamp, engraving, molding, or marking physically attached to the product.'
      : 'No watermark removal is requested. Preserve every physical product marking and remove only unrelated surrounding background elements.';

  return `${PARTQUILL_INTEGRITY_PROMPT}\n\n${backgroundRule}\n\n${watermarkRule}\n\nReturn exactly one finished catalog image for this one source image.`;
}

export const STUDIO_QA_PROMPT = `You are the final QA inspector for an automotive ecommerce image.
Image 1 is the untouched source. Image 2 is the edited candidate.

Return ONLY JSON with this exact shape:
{"pass":true,"geometry_or_piece_count_problem":false,"washed_out_or_hazy":false,"crop_or_edge_problem":false,"invented_or_missing_detail":false,"background_problem":false,"reason":"short explanation"}

FAIL if the candidate changes product geometry, holes, openings, labels, markings, connectors, damage, wear, material, color, orientation, quantity or piece count; invents or removes product detail; crops any item edge; looks washed out, hazy or low-detail; or is not isolated cleanly on the requested simple catalog background.

The edited image is presentation only. Never infer product identity or fitment from it.`;
