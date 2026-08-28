import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import {
  selectExactEbayReference,
  type EbayBrowseItem,
  type EbayReferenceProvider
} from './reference-discovery.js';
import type { EbayReferenceCandidate } from './reference-types.js';

/** Exact public listings reviewed against PartQuill catalog evidence. */
const reviewedListings: Record<string, EbayBrowseItem> = {
  '5455055': {
    itemId: '165201602251',
    title: '1955-1956 Oldsmobile Brake Vacuum Cylinder Repair Kit NOS Delco OEM #5455055',
    itemWebUrl: 'https://www.ebay.com/itm/165201602251',
    categoryId: '33566',
    categoryPath: 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories › Brakes & Brake Parts › Other Brake Parts',
    localizedAspects: [
      { name: 'Brand', value: 'Delco/GM' },
      { name: 'Manufacturer Part Number', value: '5455055' }
    ],
    image: { imageUrl: 'https://i.ebayimg.com/images/g/esgAAOSwxSphn3bC/s-l1600.jpg' },
    additionalImages: [
      { imageUrl: 'https://i.ebayimg.com/images/g/WDsAAOSwBgphn3bF/s-l1600.jpg' },
      { imageUrl: 'https://i.ebayimg.com/images/g/WEkAAOSwBgphn3bI/s-l1600.jpg' }
    ]
  }
};

export class CuratedEbayReferenceProvider implements EbayReferenceProvider {
  async searchExact(partNumber: string, catalog: GmCatalogPart): Promise<EbayReferenceCandidate | undefined> {
    const exactPart = canonicalOemPartNumber(partNumber);
    const listing = reviewedListings[exactPart];
    const candidate = listing ? selectExactEbayReference(exactPart, catalog, listing, 3) : undefined;
    if (!candidate) return undefined;
    return {
      ...candidate,
      archiveState: 'PRIVATE_PERSONAL_REFERENCE_ONLY',
      images: candidate.images.map((image, index) => ({
        ...image,
        alt: `Permanent archived reference ${index + 1} for OEM part 5455055`,
        url: `/v1/reference-assets/5455055${index === 0 ? '' : `_${index}`}.png`,
        contentReview: {
          decision: 'ACCEPT_PART_ONLY',
          method: 'MANUAL_EXACT_LISTING_REVIEW',
          containsPerson: false,
          containsFace: false,
          containsHand: false,
          containsBodyPart: false,
          containsMarketplacePromo: false,
          containsWatermarkOrOverlay: false,
          checkedAt: '2026-08-28T11:30:00Z'
        }
      }))
    };
  }
}
