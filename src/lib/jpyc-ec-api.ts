/**
 * JPYC EC Platform REST API client (native fetch only).
 *
 * Production base:  https://ec.jpyc-service.com/api/v1     — mainnet chains only
 * Staging base:     https://stg-ec.jpyc-service.com/api/v1 — testnet chains only
 */

export const PRODUCTION_API_BASE = 'https://ec.jpyc-service.com/api/v1';
export const STAGING_API_BASE = 'https://stg-ec.jpyc-service.com/api/v1';

/** JPYC FSA (v2) コントラクトアドレス — CREATE2 により全 EVM チェーン共通 */
export const JPYC_CONTRACT_ADDRESS = '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';

/** EIP-712 domain の name（JPYC FSA contract が署名検証時に要求する厳密な値） */
export const JPYC_EIP712_DOMAIN_NAME = 'JPY Coin';
export const JPYC_EIP712_DOMAIN_VERSION = '1';

export type Env = 'production' | 'staging';

/** production/staging と chain name → chainId のマッピング */
const PRODUCTION_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  avalanche: 43114,
};
const STAGING_CHAIN_IDS: Record<string, number> = {
  sepolia: 11155111,
  'polygon-amoy': 80002,
  fuji: 43113,
};

/** 指定された env に属する chain name から chainId を解決 */
export function resolveChainId(env: Env, chainName: string): number | undefined {
  const map = env === 'production' ? PRODUCTION_CHAIN_IDS : STAGING_CHAIN_IDS;
  return map[chainName.toLowerCase()];
}

export function getApiBase(env: Env): string {
  return env === 'production' ? PRODUCTION_API_BASE : STAGING_API_BASE;
}

/** JPYC EC API のレスポンス envelope */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}
export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export class JpycEcApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'JpycEcApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getApiBase(env)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok) {
    throw new JpycEcApiError(body.error.code, body.error.message, res.status);
  }
  return body.data;
}

export interface Shop {
  id: string;
  slug: string;
  name: string;
  description?: string;
  logo_url?: string;
  available_chains: number[];
  default_chain_id: number;
  free_shipping_threshold?: string;
  wallet_address?: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  price_jpyc: string;
  stock: number;
  image_urls: string[];
  requires_shipping: boolean;
  grants_free_shipping: boolean;
}

export interface ShopWithProducts {
  shop: Shop;
  products: Product[];
}

export interface ShippingFeeResponse {
  shipping_fee: string;
  reason:
    | 'standard_rate'
    | 'free_shipping_product'
    | 'threshold_met'
    | 'local_delivery'
    | 'no_shipping_items'
    | 'no_rate_configured';
}

export interface BalanceCheckResponse {
  sufficient: boolean;
  balance: string;
  required: string;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  nonce: string;
  valid_after: string;
  valid_before: string;
  subtotal_jpyc: string;
  shipping_jpyc: string;
  total_jpyc: string;
  chain_id: number;
  order_status: number;
  created_at: string;
  tx_hash?: string | null;
  items?: Array<{ product_name: string; price_jpyc: string; quantity: number }>;
}

export interface CreateOrderResponse {
  order: OrderRecord;
  shop_wallet_address: string;
  items: Array<{ product_name: string; price_jpyc: string; quantity: number }>;
}

export interface SubmitSignatureResponse {
  order_id: string;
  order_number: string;
  order_status: number;
  signed_at: string;
}

export interface ListShopsResponse {
  shops: Shop[];
}

export interface ListOrdersResponse {
  orders: OrderRecord[];
}

export async function listShops(env: Env): Promise<Shop[]> {
  const data = await request<ListShopsResponse>(env, '/shops');
  return data.shops;
}

export async function getShopProducts(
  env: Env,
  slug: string,
): Promise<ShopWithProducts> {
  return request<ShopWithProducts>(env, `/shops/${encodeURIComponent(slug)}/products`);
}

export interface ProductDetail {
  product: Product;
  shop: Shop;
}

export async function getProduct(env: Env, productId: string): Promise<ProductDetail> {
  return request<ProductDetail>(env, `/products/${encodeURIComponent(productId)}`);
}

export interface ShippingFeeRequest {
  shop_id: string;
  prefecture: string;
  items: Array<{ product_id: string; quantity: number }>;
  city?: string;
}

export async function calculateShippingFee(
  env: Env,
  req: ShippingFeeRequest,
): Promise<ShippingFeeResponse> {
  return request<ShippingFeeResponse>(env, '/shipping/fee', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export interface BalanceCheckRequest {
  address: string;
  required_amount: string;
  chain_id: number;
}

export async function checkBalance(
  env: Env,
  req: BalanceCheckRequest,
): Promise<BalanceCheckResponse> {
  return request<BalanceCheckResponse>(env, '/balance/check', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export interface CreateOrderRequest {
  shop_id: string;
  customer_address: string;
  chain_id: number;
  items: Array<{ product_id: string; quantity: number }>;
  customer_name?: string;
  customer_email?: string;
  customer_note?: string;
  shipping_prefecture?: string;
  shipping_address1?: string;
  shipping_address2?: string;
  shipping_zip?: string;
  shipping_tel?: string;
}

export async function createOrder(
  env: Env,
  req: CreateOrderRequest,
): Promise<CreateOrderResponse> {
  return request<CreateOrderResponse>(env, '/orders', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function submitSignature(
  env: Env,
  orderId: string,
  signature: string,
  customerAddress: string,
): Promise<SubmitSignatureResponse> {
  return request<SubmitSignatureResponse>(env, `/orders/${encodeURIComponent(orderId)}/signature`, {
    method: 'POST',
    body: JSON.stringify({ signature, customer_address: customerAddress }),
  });
}

export async function listOrders(env: Env, customerAddress: string): Promise<OrderRecord[]> {
  const data = await request<ListOrdersResponse>(
    env,
    `/orders?customer_address=${encodeURIComponent(customerAddress)}`,
  );
  return data.orders;
}

/**
 * EIP-3009 receiveWithAuthorization の typed data を組み立てる。
 * ctx.wallet.signTypedData() に渡す JSON 文字列を返す。
 *
 * @param chainId - 送金するチェーンの chainId
 * @param fromAddress - 支払う側（署名者）のアドレス
 * @param toAddress - ショップの wallet アドレス
 * @param totalJpyc - total_jpyc（"2300.000000000000000000" 形式）。整数部を wei に変換
 * @param validAfter - valid_after（文字列 uint256）
 * @param validBefore - valid_before（文字列 uint256）
 * @param nonce - order.nonce（0x で始まる bytes32）
 */
export function buildReceiveWithAuthorizationTypedData(params: {
  chainId: number;
  fromAddress: string;
  toAddress: string;
  totalJpyc: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}): string {
  const integerPart = params.totalJpyc.split('.')[0];
  const valueWei = `${integerPart}000000000000000000`; // 18 decimals

  const typedData = {
    domain: {
      name: JPYC_EIP712_DOMAIN_NAME,
      version: JPYC_EIP712_DOMAIN_VERSION,
      chainId: params.chainId,
      verifyingContract: JPYC_CONTRACT_ADDRESS,
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ReceiveWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: params.fromAddress,
      to: params.toAddress,
      value: valueWei,
      validAfter: params.validAfter,
      validBefore: params.validBefore,
      nonce: params.nonce,
    },
  };
  return JSON.stringify(typedData);
}
