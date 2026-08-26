export const PARTQUILL_CHATGPT_EDIT_PROMPT = `Use this seller-owned or seller-authorized automotive-part photograph as the sole visual source. Return exactly one high-resolution, eBay-ready catalog derivative for this one source image.

NON-NEGOTIABLE ITEM INTEGRITY:
- Preserve the photographed item exactly: geometry, proportions, connectors, holes, edges, labels, part numbers, logos, colors, materials, wear, scratches, stains, damage and condition.
- Preserve the complete item, every separate piece, the original camera angle and the actual quantity shown.
- Never crop an item edge, invent missing detail, repair damage, beautify the part, change label text, add parts, remove parts, merge views or create a collage.

ALLOWED EDITS:
- Improve clarity by reducing haze, pixelation, compression noise, color cast and uneven lighting without changing the physical item.
- Remove only the surrounding background, props, floor, box debris and seller-authorized background watermark or branding.
- Never remove or alter a marking, label, serial number or logo physically printed, stamped, molded or attached to the item.
- Place the complete item inside a pure-white square studio background with comfortable, even margins and neutral catalog lighting.
- Do not add packaging, text, badges, hands, scenery, props, extra parts or replacement logos.

Return one finished image only. If a faithful edit is not possible, stop instead of changing the part.`;

export function buildConnectedImagePrompt(jobCode: string, sources: string[]): string {
  const manifest = sources.map((name, index) => `${index + 1}. ${name}`).join('\n');
  return `PARTQUILL IMAGE JOB: ${jobCode}
SOURCE COUNT: ${sources.length}

${PARTQUILL_CHATGPT_EDIT_PROMPT}

PARTQUILL LISTING-SET RULES:
- Treat every attached image as a separate source and return one separate finished derivative per source.
- Never merge angles, combine parts, change the quantity shown or create a collage.
- Keep the same numbered order. Continue until every possible source has a separate finished image.
- Do not stop after describing the work or giving a written summary.

SOURCE ORDER:
${manifest}

WHEN THE EDITS ARE COMPLETE:
1. Keep every finished image as a separate output in the same numbered order.
2. Call the PartQuill return_edited_images tool with job_code ${jobCode} and every completed image if the host exposes the generated files to tools.
3. If the host cannot pass generated image files to that tool, leave every result in this same conversation and state: "PartQuill automatic return is unavailable in this host session."
4. If any source cannot be edited faithfully, identify that source number as unresolved instead of inventing a replacement.`;
}
