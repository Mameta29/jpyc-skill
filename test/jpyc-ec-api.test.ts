import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../src/lib/jpyc-ec-api.js';

describe('jpyc-ec-api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('resolveChainId', () => {
    it('production の ethereum/polygon/avalanche を解決する', () => {
      expect(api.resolveChainId('production', 'ethereum')).toBe(1);
      expect(api.resolveChainId('production', 'polygon')).toBe(137);
      expect(api.resolveChainId('production', 'avalanche')).toBe(43114);
    });

    it('staging の sepolia/polygon-amoy/fuji を解決する', () => {
      expect(api.resolveChainId('staging', 'sepolia')).toBe(11155111);
      expect(api.resolveChainId('staging', 'polygon-amoy')).toBe(80002);
      expect(api.resolveChainId('staging', 'fuji')).toBe(43113);
    });

    it('production に testnet chain を渡すと undefined を返す', () => {
      expect(api.resolveChainId('production', 'sepolia')).toBeUndefined();
      expect(api.resolveChainId('production', 'fuji')).toBeUndefined();
    });

    it('staging に mainnet chain を渡すと undefined を返す', () => {
      expect(api.resolveChainId('staging', 'ethereum')).toBeUndefined();
    });

    it('大文字混在でも解決する', () => {
      expect(api.resolveChainId('production', 'POLYGON')).toBe(137);
      expect(api.resolveChainId('production', 'Avalanche')).toBe(43114);
    });
  });

  describe('getApiBase', () => {
    it('production の base URL を返す', () => {
      expect(api.getApiBase('production')).toBe('https://ec.jpyc-service.com/api/v1');
    });

    it('staging の base URL を返す', () => {
      expect(api.getApiBase('staging')).toBe('https://stg-ec.jpyc-service.com/api/v1');
    });
  });

  describe('buildReceiveWithAuthorizationTypedData', () => {
    it('正しい typed data JSON を組み立てる', () => {
      const json = api.buildReceiveWithAuthorizationTypedData({
        chainId: 137,
        fromAddress: '0xfrom',
        toAddress: '0xto',
        totalJpyc: '2300.000000000000000000',
        validAfter: '0',
        validBefore: '1712345678',
        nonce: '0xabcdef',
      });
      const parsed = JSON.parse(json);
      expect(parsed.domain.name).toBe('JPY Coin');
      expect(parsed.domain.version).toBe('1');
      expect(parsed.domain.chainId).toBe(137);
      expect(parsed.domain.verifyingContract).toBe('0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29');
      expect(parsed.primaryType).toBe('ReceiveWithAuthorization');
      expect(parsed.message.from).toBe('0xfrom');
      expect(parsed.message.to).toBe('0xto');
      expect(parsed.message.value).toBe('2300000000000000000000'); // 2300 * 10^18
      expect(parsed.message.validAfter).toBe('0');
      expect(parsed.message.validBefore).toBe('1712345678');
      expect(parsed.message.nonce).toBe('0xabcdef');
    });

    it('小数部を無視して整数部のみ wei 変換する', () => {
      const json = api.buildReceiveWithAuthorizationTypedData({
        chainId: 1,
        fromAddress: '0xa',
        toAddress: '0xb',
        totalJpyc: '100.123456789012345678',
        validAfter: '0',
        validBefore: '1',
        nonce: '0x00',
      });
      const parsed = JSON.parse(json);
      expect(parsed.message.value).toBe('100000000000000000000');
    });
  });

  describe('listShops (fetch mocked)', () => {
    it('production base に GET /shops を叩き shops を返す', async () => {
      const mockShops = [
        {
          id: 'uuid-1',
          slug: 'test-shop',
          name: 'Test Shop',
          available_chains: [137],
          default_chain_id: 137,
        },
      ];
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { shops: mockShops } }), { status: 200 }),
      );

      const shops = await api.listShops('production');
      expect(shops).toEqual(mockShops);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ec.jpyc-service.com/api/v1/shops',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });

    it('API エラーレスポンスを JpycEcApiError に変換する', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
          { status: 429 },
        ),
      );

      const err = await api.listShops('production').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(api.JpycEcApiError);
      expect((err as api.JpycEcApiError).code).toBe('RATE_LIMITED');
      expect((err as api.JpycEcApiError).status).toBe(429);
    });
  });

  describe('submitSignature', () => {
    it('POST /orders/:id/signature を正しく叩く', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              order_id: 'order-1',
              order_number: 'ORD-123',
              order_status: 2,
              signed_at: '2026-04-19T00:00:00Z',
            },
          }),
          { status: 200 },
        ),
      );

      const res = await api.submitSignature('production', 'order-1', '0xsig', '0xaddr');
      expect(res.order_number).toBe('ORD-123');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ec.jpyc-service.com/api/v1/orders/order-1/signature',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ signature: '0xsig', customer_address: '0xaddr' }),
        }),
      );
    });
  });

  describe('listCategories (fetch mocked)', () => {
    it('GET /categories を叩き 3 種類の配列を返す', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              shop_categories: ['食品', '書籍'],
              product_categories: ['写真集'],
              product_tags: ['お米'],
            },
          }),
          { status: 200 },
        ),
      );
      const res = await api.listCategories('production');
      expect(res.shop_categories).toEqual(['食品', '書籍']);
      expect(res.product_categories).toEqual(['写真集']);
      expect(res.product_tags).toEqual(['お米']);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ec.jpyc-service.com/api/v1/categories',
        expect.anything(),
      );
    });
  });

  describe('getProductReviews (fetch mocked)', () => {
    it('GET /products/:id/reviews を叩きレビューを返す', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              product_id: 'p-1',
              avg_rating: 4.5,
              review_count: 1,
              reviews: [
                {
                  id: 'r-1',
                  customer_address: '0xF243...E853',
                  rating: 5,
                  title: 'good',
                  content: 'nice',
                  created_at: '2026-04-20T00:00:00Z',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );
      const res = await api.getProductReviews('production', 'p-1');
      expect(res.avg_rating).toBe(4.5);
      expect(res.reviews).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ec.jpyc-service.com/api/v1/products/p-1/reviews',
        expect.anything(),
      );
    });
  });

  describe('listNftDiscounts (fetch mocked)', () => {
    it('GET /shops/:slug/nft-discounts を叩き discount_rules を返す', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              shop_id: 's-1',
              discount_rules: [
                {
                  id: 'rule-1',
                  name: 'SBT 10% off',
                  contract_address: '0xabc',
                  chain_id: 137,
                  condition_type: 'balance',
                  condition_value: { min_balance: 1 },
                  discount_type: 'percentage',
                  discount_value: '10.00',
                  apply_to_all: true,
                  product_ids: 'all',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );
      const res = await api.listNftDiscounts('production', 'kl-shop');
      expect(res.discount_rules).toHaveLength(1);
      expect(res.discount_rules[0]!.name).toBe('SBT 10% off');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://ec.jpyc-service.com/api/v1/shops/kl-shop/nft-discounts',
        expect.anything(),
      );
    });
  });

  describe('buildDiscountObjectForSingleProduct', () => {
    const baseRule: api.NftDiscountRule = {
      id: 'rule-1',
      name: 'SBT 10% off',
      contract_address: '0xabc',
      chain_id: 137,
      condition_type: 'balance',
      condition_value: { min_balance: 1 },
      discount_type: 'percentage',
      discount_value: '10',
      apply_to_all: true,
      product_ids: 'all',
    };

    it('percentage / apply_to_all=true で総額の 10% を算出', () => {
      const d = api.buildDiscountObjectForSingleProduct({
        rule: baseRule,
        productId: 'p-1',
        subtotalInt: 1500,
      });
      expect(d).toBeDefined();
      expect(d!.total_discount).toBe('150');
      expect(d!.item_discounts['p-1']!.discount_amount).toBe('150');
      const snapshot = JSON.parse(d!.item_discounts['p-1']!.rule_snapshot);
      expect(snapshot.discount_type).toBe('percentage');
      expect(snapshot.discount_value).toBe('10');
    });

    it('fixed / subtotal を超えない固定額を算出', () => {
      const d = api.buildDiscountObjectForSingleProduct({
        rule: { ...baseRule, discount_type: 'fixed', discount_value: '500' },
        productId: 'p-1',
        subtotalInt: 1500,
      });
      expect(d!.total_discount).toBe('500');
    });

    it('fixed が subtotal より大きい場合は subtotal に clip', () => {
      const d = api.buildDiscountObjectForSingleProduct({
        rule: { ...baseRule, discount_type: 'fixed', discount_value: '2000' },
        productId: 'p-1',
        subtotalInt: 1500,
      });
      expect(d!.total_discount).toBe('1500');
    });

    it('apply_to_all=false かつ product_ids に含まれない商品は undefined', () => {
      const d = api.buildDiscountObjectForSingleProduct({
        rule: { ...baseRule, apply_to_all: false, product_ids: ['p-other'] },
        productId: 'p-1',
        subtotalInt: 1500,
      });
      expect(d).toBeUndefined();
    });

    it('apply_to_all=false でも product_ids に含まれていれば算出', () => {
      const d = api.buildDiscountObjectForSingleProduct({
        rule: { ...baseRule, apply_to_all: false, product_ids: ['p-1'] },
        productId: 'p-1',
        subtotalInt: 1000,
      });
      expect(d!.total_discount).toBe('100');
    });

    it('discount_value が 0 以下や不正のときは undefined', () => {
      expect(
        api.buildDiscountObjectForSingleProduct({
          rule: { ...baseRule, discount_value: '0' },
          productId: 'p-1',
          subtotalInt: 1500,
        }),
      ).toBeUndefined();
      expect(
        api.buildDiscountObjectForSingleProduct({
          rule: { ...baseRule, discount_value: 'abc' },
          productId: 'p-1',
          subtotalInt: 1500,
        }),
      ).toBeUndefined();
    });
  });

  describe('createOrder with discount (fetch mocked)', () => {
    it('discount オブジェクトを含めて POST /orders を叩く', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              order: {
                id: 'o-1',
                order_number: 'ORD-1',
                nonce: '0x00',
                valid_after: '0',
                valid_before: '1',
                subtotal_jpyc: '1500.000000000000000000',
                discount_jpyc: '150.000000000000000000',
                shipping_jpyc: '0.000000000000000000',
                total_jpyc: '1350.000000000000000000',
                chain_id: 137,
                order_status: 1,
                created_at: '2026-04-20T00:00:00Z',
              },
              shop_wallet_address: '0xshop',
              items: [],
            },
          }),
          { status: 200 },
        ),
      );
      const req: api.CreateOrderRequest = {
        shop_id: 's-1',
        customer_address: '0xcust',
        chain_id: 137,
        items: [{ product_id: 'p-1', quantity: 1 }],
        discount: {
          rule_id: 'rule-1',
          total_discount: '150',
          item_discounts: {
            'p-1': { discount_amount: '150', rule_snapshot: '{}' },
          },
        },
      };
      const res = await api.createOrder('production', req);
      expect(res.order.discount_jpyc).toBe('150.000000000000000000');
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs![1].body);
      expect(body.discount.rule_id).toBe('rule-1');
      expect(body.discount.total_discount).toBe('150');
    });
  });
});
