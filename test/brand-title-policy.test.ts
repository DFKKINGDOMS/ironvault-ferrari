import { describe, expect, it } from 'vitest';
import {
  applyEbayBrandTitlePolicy,
  ebayVeroParticipantForBrand
} from '../src/ebay/brand-title-policy.js';

describe('eBay brand title policy', () => {
  it('allows a truthful genuine item brand without Fits/For', () => {
    const result = applyEbayBrandTitlePolicy({
      itemBrand: 'John Deere',
      compatibleBrand: 'John Deere',
      relationship: 'GENUINE_BRANDED_ITEM',
      manufacturerPartNumber: 'AM12345',
      productName: 'Hydraulic Filter'
    });
    expect(result.title).toBe('John Deere AM12345 Hydraulic Filter');
    expect(result.rule).toBe('GENUINE_BRAND_ALLOWED');
    expect(result.sellerConfirmationRequired).toBe(false);
  });

  it('prefixes a compatible vehicle brand for aftermarket or unconfirmed items', () => {
    const result = applyEbayBrandTitlePolicy({
      itemBrand: null,
      compatibleBrand: 'Oldsmobile',
      relationship: 'AUTHENTICITY_NOT_CONFIRMED',
      manufacturerPartNumber: '5455055',
      productName: 'Oldsmobile Moraine Vacuum Cylinder Repair Kit',
      applicationYears: '1955–1956'
    });
    expect(result.title).toBe('5455055 Moraine Vacuum Cylinder Repair Kit Fits Oldsmobile 1955–1956');
    expect(result.veroParticipant).toBe('General Motors');
    expect(result.state).toBe('SELLER_CONFIRMATION_REQUIRED');
  });

  it('proper-cases generated titles while preserving OEM acronyms', () => {
    const result = applyEbayBrandTitlePolicy({
      itemBrand: 'ACDELCO',
      compatibleBrand: 'oldsmobile',
      relationship: 'AFTERMARKET_COMPATIBLE',
      manufacturerPartNumber: 'ab12',
      productName: 'VACUUM CYLINDER REPAIR KIT'
    });
    expect(result.title).toBe('ACDelco AB12 Vacuum Cylinder Repair Kit Fits Oldsmobile');
  });

  it('does not treat absence from the public profile index as permission', () => {
    expect(ebayVeroParticipantForBrand('Ferrari')).toBeNull();
    const result = applyEbayBrandTitlePolicy({
      itemBrand: 'Aftermarket Co',
      compatibleBrand: 'Ferrari',
      relationship: 'AFTERMARKET_COMPATIBLE',
      manufacturerPartNumber: '123456',
      productName: 'Engine Bracket'
    });
    expect(result.title).toContain('Fits Ferrari');
    expect(result.registryCompleteness).toBe('OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE');
  });
});
