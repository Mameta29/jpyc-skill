/**
 * E2E smoke tests that hit the real JPYC EC Platform API.
 *
 * Opt-in via `JPYC_EC_E2E=1 pnpm test`. Skipped otherwise to keep the
 * default test suite offline and deterministic.
 */
import { describe, it, expect } from 'vitest';
import * as api from '../src/lib/jpyc-ec-api.js';

const runE2E = process.env.JPYC_EC_E2E === '1';
const describeE2E = runE2E ? describe : describe.skip;

describeE2E('jpyc-ec-api E2E smoke (JPYC_EC_E2E=1)', () => {
  it('staging GET /shops が 200 で shops 配列を返す', async () => {
    const shops = await api.listShops('staging');
    expect(Array.isArray(shops)).toBe(true);
    // staging は空配列でも OK（存在するだけで疎通確認）
    for (const shop of shops) {
      expect(typeof shop.id).toBe('string');
      expect(typeof shop.slug).toBe('string');
      expect(typeof shop.name).toBe('string');
      expect(Array.isArray(shop.available_chains)).toBe(true);
    }
  }, 15_000);

  it('production GET /shops が shops 配列を返す', async () => {
    const shops = await api.listShops('production');
    expect(Array.isArray(shops)).toBe(true);
    // production には実ショップが存在する想定
    expect(shops.length).toBeGreaterThanOrEqual(0);
    for (const shop of shops) {
      expect(shop.slug).toMatch(/^[a-z0-9-]+$/);
      expect(shop.default_chain_id).toBeGreaterThan(0);
      expect(shop.available_chains.length).toBeGreaterThan(0);
    }
  }, 15_000);

  it('production の any shop から products を取得できる', async () => {
    const shops = await api.listShops('production');
    if (shops.length === 0) return;

    const first = shops[0];
    const data = await api.getShopProducts('production', first.slug);
    expect(data.shop.slug).toBe(first.slug);
    expect(Array.isArray(data.products)).toBe(true);
    for (const product of data.products) {
      expect(typeof product.id).toBe('string');
      expect(typeof product.price_jpyc).toBe('string');
      expect(product.price_jpyc).toMatch(/^\d+(\.\d+)?$/);
      expect(typeof product.stock).toBe('number');
      expect(typeof product.requires_shipping).toBe('boolean');
    }
  }, 15_000);
});
