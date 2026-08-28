import { z } from 'zod';

const money = z.string().regex(/^\d+(\.\d{2})$/, 'money must use 0.00 format');
const ebayMotorsPrice = money.refine((value) => Number(value) >= 0.99, 'eBay Motors price must be at least 0.99');

export const listingPayloadSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(80),
  description: z.string().min(1).max(500_000),
  condition: z.enum(['NEW', 'USED', 'REMANUFACTURED', 'FOR_PARTS_OR_NOT_WORKING']),
  conditionId: z.string().regex(/^\d+$/).optional(),
  categoryId: z.string().regex(/^\d+$/),
  secondaryCategoryId: z.string().regex(/^\d+$/).optional(),
  brand: z.string().trim().min(1).optional(),
  mpn: z.string().trim().min(1).optional(),
  gtin: z.string().regex(/^\d{8,14}$/).optional(),
  epid: z.string().min(1).optional(),
  price: z.object({ currency: z.literal('USD'), value: ebayMotorsPrice }),
  saleMode: z.literal('FIXED_PRICE').default('FIXED_PRICE'),
  quantity: z.number().int().min(0).max(999_999),
  aspects: z.record(z.string(), z.array(z.string().min(1)).min(1)),
  compatibility: z.array(z.record(z.string(), z.string())),
  shippingPolicyId: z.string().optional(),
  paymentPolicyId: z.string().optional(),
  returnPolicyId: z.string().optional(),
  merchantLocationKey: z.string().optional(),
  countryOfOrigin: z.string().length(2).optional(),
  hsCode: z.string().regex(/^\d{6,10}$/).optional(),
  internationalEligible: z.boolean().default(false),
  imageIds: z.array(z.string()).default([]),
  core: z
    .object({
      amount: money,
      returnWindowDays: z.number().int().positive().max(365),
      acceptableCriteria: z.string().min(1).max(2_000),
      includedInCheckoutTotal: z.boolean()
    })
    .optional()
});

export const createItemSchema = z.object({
  sellerId: z.string().min(1),
  runId: z.string().min(1),
  inventoryAuthority: z
    .enum(['partquill_master', 'shopify_master', 'erp_dms_master', 'manual_ebay'])
    .default('partquill_master'),
  payload: listingPayloadSchema
});

export const approvalSchema = z.object({
  actorId: z.string().min(1),
  payloadHash: z.string().length(64),
  feeEstimateId: z.string().min(1).optional()
});

export const reviseSchema = z.object({
  actorId: z.string().min(1),
  price: ebayMotorsPrice.optional(),
  quantity: z.number().int().min(0).max(999_999).optional()
}).refine((input) => input.price !== undefined || input.quantity !== undefined, 'price or quantity is required');
