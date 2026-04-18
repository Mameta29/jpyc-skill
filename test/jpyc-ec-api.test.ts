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
});
