import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';
import type { PluginContext } from '../types.js';
import * as api from '../lib/jpyc-ec-api.js';
import {
  resolveChainId,
  getApiBase,
  buildReceiveWithAuthorizationTypedData,
  buildDiscountObjectForSingleProduct,
  type Env,
  type NftDiscountRule,
  type CreateOrderDiscount,
} from '../lib/jpyc-ec-api.js';

type BrowseArgs = { shop?: string; env?: string };
type CategoriesArgs = { env?: string };
type ReviewsArgs = { product: string; env?: string };
type NftDiscountsArgs = { shop: string; env?: string };
type QuoteArgs = {
  product: string;
  qty: number;
  chain: string;
  wallet?: string;
  shippingPrefecture?: string;
  shippingCity?: string;
  discountRuleId?: string;
  env?: string;
};
type BuyArgs = {
  wallet: string;
  product: string;
  qty: number;
  chain: string;
  shippingName?: string;
  shippingEmail?: string;
  shippingPrefecture?: string;
  shippingAddress1?: string;
  shippingAddress2?: string;
  shippingZip?: string;
  shippingTel?: string;
  customerNote?: string;
  discountRuleId?: string;
  env?: string;
  apiKey?: string;
  passphrase?: string;
};
type TrackArgs = { wallet?: string; address?: string; env?: string };

function normalizeEnv(raw: string | undefined): Env {
  if (raw === 'staging' || raw === 'stg') return 'staging';
  return 'production';
}

export function buildJpycEcCommand(ctx: PluginContext): CommandModule {
  return {
    command: 'jpyc-ec <subcommand>',
    describe:
      'JPYC EC Platform purchase commands (browse / categories / reviews / nft-discounts / quote / buy / track)',
    builder: (yargs: Argv) => {
      return yargs
        .command(
          'browse',
          'List shops or products for a shop',
          (y) =>
            y
              .option('shop', { type: 'string', describe: 'Shop slug to list its products' })
              .option('env', { type: 'string', choices: ['production', 'staging'], default: 'production', describe: 'API environment' }),
          (argv: ArgumentsCamelCase<BrowseArgs>) => browseHandler(ctx, argv),
        )
        .command(
          'categories',
          'List shop categories, product categories, and product tags',
          (y) =>
            y.option('env', {
              type: 'string',
              choices: ['production', 'staging'],
              default: 'production',
              describe: 'API environment',
            }),
          (argv: ArgumentsCamelCase<CategoriesArgs>) => categoriesHandler(ctx, argv),
        )
        .command(
          'reviews',
          'Show reviews for a product (from verified purchasers)',
          (y) =>
            y
              .option('product', { type: 'string', demandOption: true, describe: 'Product UUID' })
              .option('env', {
                type: 'string',
                choices: ['production', 'staging'],
                default: 'production',
                describe: 'API environment',
              }),
          (argv: ArgumentsCamelCase<ReviewsArgs>) => reviewsHandler(ctx, argv),
        )
        .command(
          'nft-discounts',
          'Show NFT/SBT discount rules for a shop',
          (y) =>
            y
              .option('shop', { type: 'string', demandOption: true, describe: 'Shop slug' })
              .option('env', {
                type: 'string',
                choices: ['production', 'staging'],
                default: 'production',
                describe: 'API environment',
              }),
          (argv: ArgumentsCamelCase<NftDiscountsArgs>) => nftDiscountsHandler(ctx, argv),
        )
        .command(
          'quote',
          'Calculate total (with shipping, discount, and balance check)',
          (y) =>
            y
              .option('product', { type: 'string', demandOption: true, describe: 'Product UUID' })
              .option('qty', { type: 'number', default: 1, describe: 'Quantity' })
              .option('chain', { type: 'string', demandOption: true, describe: 'Chain name (ethereum, polygon, avalanche, sepolia, polygon-amoy, fuji)' })
              .option('wallet', { type: 'string', describe: 'Wallet name for balance check' })
              .option('shipping-prefecture', { type: 'string', describe: 'Shipping prefecture (required if product requires shipping)' })
              .option('shipping-city', { type: 'string', describe: 'Shipping city (optional)' })
              .option('discount-rule-id', { type: 'string', describe: 'NFT/SBT discount rule UUID to apply' })
              .option('env', { type: 'string', choices: ['production', 'staging'], default: 'production', describe: 'API environment' }),
          (argv: ArgumentsCamelCase<QuoteArgs>) => quoteHandler(ctx, argv),
        )
        .command(
          'buy',
          'Create order, sign EIP-3009 authorization, and submit signature',
          (y) =>
            y
              .option('wallet', { type: 'string', demandOption: true, describe: 'Wallet name (from acli wallet list)' })
              .option('product', { type: 'string', demandOption: true, describe: 'Product UUID' })
              .option('qty', { type: 'number', default: 1, describe: 'Quantity' })
              .option('chain', { type: 'string', demandOption: true, describe: 'Chain name (ethereum, polygon, avalanche, sepolia, polygon-amoy, fuji)' })
              .option('shipping-name', { type: 'string', describe: 'Customer name' })
              .option('shipping-email', { type: 'string', describe: 'Customer email' })
              .option('shipping-prefecture', { type: 'string', describe: 'Prefecture' })
              .option('shipping-address1', { type: 'string', describe: 'Address line 1' })
              .option('shipping-address2', { type: 'string', describe: 'Address line 2' })
              .option('shipping-zip', { type: 'string', describe: 'Postal code' })
              .option('shipping-tel', { type: 'string', describe: 'Phone' })
              .option('customer-note', { type: 'string', describe: 'Customer note (max 2000 chars)' })
              .option('discount-rule-id', { type: 'string', describe: 'NFT/SBT discount rule UUID to apply' })
              .option('env', { type: 'string', choices: ['production', 'staging'], default: 'production', describe: 'API environment' })
              .option('api-key', { type: 'string', describe: 'OWS API key (for agent-mode signing)' })
              .option('passphrase', { type: 'string', describe: 'Wallet passphrase for owner-mode signing (alternative to agent-mode api-key). Leaks via shell history — prefer agent mode.' }),
          (argv: ArgumentsCamelCase<BuyArgs>) => buyHandler(ctx, argv),
        )
        .command(
          'track',
          'List orders for a wallet',
          (y) =>
            y
              .option('wallet', { type: 'string', describe: 'Wallet name to resolve address from' })
              .option('address', { type: 'string', describe: 'Wallet address directly' })
              .option('env', { type: 'string', choices: ['production', 'staging'], default: 'production', describe: 'API environment' }),
          (argv: ArgumentsCamelCase<TrackArgs>) => trackHandler(ctx, argv),
        )
        .demandCommand(
          1,
          'Specify a subcommand: browse, categories, reviews, nft-discounts, quote, buy, or track',
        );
    },
    handler: () => {},
  };
}

async function browseHandler(ctx: PluginContext, argv: ArgumentsCamelCase<BrowseArgs>) {
  try {
    const env = normalizeEnv(argv.env);
    if (argv.shop) {
      const data = await api.getShopProducts(env, argv.shop);
      ctx.output.print(
        ctx.output.success({
          env,
          apiBase: getApiBase(env),
          shop: data.shop,
          products: data.products,
          has_nft_discounts: data.has_nft_discounts ?? false,
        }),
      );
    } else {
      const shops = await api.listShops(env);
      ctx.output.print(
        ctx.output.success({ env, apiBase: getApiBase(env), shops }),
      );
    }
  } catch (err) {
    handleApiError(ctx, err);
  }
}

async function categoriesHandler(ctx: PluginContext, argv: ArgumentsCamelCase<CategoriesArgs>) {
  try {
    const env = normalizeEnv(argv.env);
    const data = await api.listCategories(env);
    ctx.output.print(ctx.output.success({ env, ...data }));
  } catch (err) {
    handleApiError(ctx, err);
  }
}

async function reviewsHandler(ctx: PluginContext, argv: ArgumentsCamelCase<ReviewsArgs>) {
  try {
    const env = normalizeEnv(argv.env);
    const data = await api.getProductReviews(env, argv.product);
    ctx.output.print(ctx.output.success({ env, ...data }));
  } catch (err) {
    handleApiError(ctx, err);
  }
}

async function nftDiscountsHandler(
  ctx: PluginContext,
  argv: ArgumentsCamelCase<NftDiscountsArgs>,
) {
  try {
    const env = normalizeEnv(argv.env);
    const data = await api.listNftDiscounts(env, argv.shop);
    ctx.output.print(ctx.output.success({ env, ...data }));
  } catch (err) {
    handleApiError(ctx, err);
  }
}

async function resolveDiscountForQuote(
  env: Env,
  shopSlug: string,
  discountRuleId: string,
  productId: string,
  subtotalInt: number,
): Promise<{ discount: CreateOrderDiscount | undefined; rule: NftDiscountRule | undefined }> {
  const rules = await api.listNftDiscounts(env, shopSlug);
  const rule = rules.discount_rules.find((r) => r.id === discountRuleId);
  if (!rule) return { discount: undefined, rule: undefined };
  const discount = buildDiscountObjectForSingleProduct({
    rule,
    productId,
    subtotalInt,
  });
  return { discount, rule };
}

async function quoteHandler(ctx: PluginContext, argv: ArgumentsCamelCase<QuoteArgs>) {
  try {
    const env = normalizeEnv(argv.env);
    const chainId = resolveChainId(env, argv.chain);
    if (!chainId) {
      ctx.output.print(
        ctx.output.error(
          'INVALID_CHAIN',
          `Chain "${argv.chain}" is not supported on ${env}. Valid: ${env === 'production' ? 'ethereum, polygon, avalanche' : 'sepolia, polygon-amoy, fuji'}`,
        ),
      );
      process.exit(1);
    }

    const productDetail = await api.getProduct(env, argv.product);
    const product = productDetail.product;
    const shop = productDetail.shop;

    if (!shop.available_chains.includes(chainId)) {
      ctx.output.print(
        ctx.output.error(
          'INVALID_CHAIN',
          `Shop "${shop.slug}" does not accept chain_id ${chainId} (${argv.chain}). Available: ${shop.available_chains.join(', ')}`,
        ),
      );
      process.exit(1);
    }

    const priceInt = Math.floor(parseFloat(product.price_jpyc));
    const subtotalInt = priceInt * argv.qty;
    let shippingFee = '0';
    let shippingReason: string | undefined;

    if (product.requires_shipping && argv.shippingPrefecture) {
      const fee = await api.calculateShippingFee(env, {
        shop_id: shop.id,
        prefecture: argv.shippingPrefecture,
        items: [{ product_id: argv.product, quantity: argv.qty }],
        city: argv.shippingCity,
      });
      shippingFee = fee.shipping_fee;
      shippingReason = fee.reason;
    }

    let discountInfo:
      | { rule_id: string; rule_name: string; amount: string }
      | undefined;
    let discountInt = 0;
    if (argv.discountRuleId) {
      const { discount, rule } = await resolveDiscountForQuote(
        env,
        shop.slug,
        argv.discountRuleId,
        argv.product,
        subtotalInt,
      );
      if (!rule) {
        ctx.output.print(
          ctx.output.error(
            'DISCOUNT_RULE_NOT_FOUND',
            `Discount rule "${argv.discountRuleId}" not found in shop "${shop.slug}"`,
          ),
        );
        process.exit(1);
      }
      if (discount) {
        discountInt = Number(discount.total_discount);
        discountInfo = {
          rule_id: rule.id,
          rule_name: rule.name,
          amount: discount.total_discount,
        };
      }
    }

    const totalInt = subtotalInt - discountInt + parseFloat(shippingFee);

    let balanceInfo: { address: string; balance: string; sufficient: boolean } | undefined;
    if (argv.wallet) {
      const address = ctx.wallet.getEvmAddress(argv.wallet);
      if (!address) {
        ctx.output.print(ctx.output.error('WALLET_NOT_FOUND', `Wallet "${argv.wallet}" not found`));
        process.exit(1);
      }
      const bal = await api.checkBalance(env, {
        address,
        required_amount: String(totalInt),
        chain_id: chainId,
      });
      balanceInfo = { address, balance: bal.balance, sufficient: bal.sufficient };
    }

    ctx.output.print(
      ctx.output.success({
        env,
        shop: { id: shop.id, slug: shop.slug, name: shop.name },
        product: {
          id: product.id,
          name: product.name,
          price_jpyc: product.price_jpyc,
          requires_shipping: product.requires_shipping,
          stock: product.stock,
          has_nft_discount: product.has_nft_discount ?? false,
        },
        chain: argv.chain,
        chainId,
        quantity: argv.qty,
        subtotal_jpyc: String(subtotalInt),
        discount_jpyc: String(discountInt),
        discount: discountInfo,
        shipping_jpyc: shippingFee,
        shipping_reason: shippingReason,
        total_jpyc: String(totalInt),
        balance: balanceInfo,
      }),
    );
  } catch (err) {
    handleApiError(ctx, err);
  }
}

async function buyHandler(ctx: PluginContext, argv: ArgumentsCamelCase<BuyArgs>) {
  try {
    const env = normalizeEnv(argv.env);
    const chainId = resolveChainId(env, argv.chain);
    if (!chainId) {
      ctx.output.print(
        ctx.output.error(
          'INVALID_CHAIN',
          `Chain "${argv.chain}" is not supported on ${env}`,
        ),
      );
      process.exit(1);
    }

    const walletId = ctx.wallet.getWalletId(argv.wallet);
    const address = ctx.wallet.getEvmAddress(argv.wallet);
    if (!walletId || !address) {
      ctx.output.print(ctx.output.error('WALLET_NOT_FOUND', `Wallet "${argv.wallet}" not found`));
      process.exit(1);
    }

    const productDetail = await api.getProduct(env, argv.product);
    const product = productDetail.product;
    const shop = productDetail.shop;

    if (product.requires_shipping) {
      const missing = ['shippingPrefecture', 'shippingAddress1', 'shippingZip', 'shippingTel'].filter(
        (k) => !argv[k as keyof BuyArgs],
      );
      if (missing.length > 0) {
        ctx.output.print(
          ctx.output.error(
            'VALIDATION_ERROR',
            `Product requires shipping but missing: ${missing.join(', ')}`,
          ),
        );
        process.exit(1);
      }
    }

    if (!shop.available_chains.includes(chainId)) {
      ctx.output.print(
        ctx.output.error(
          'INVALID_CHAIN',
          `Shop "${shop.slug}" does not accept chain_id ${chainId}`,
        ),
      );
      process.exit(1);
    }

    let discountObject: CreateOrderDiscount | undefined;
    if (argv.discountRuleId) {
      const priceInt = Math.floor(parseFloat(product.price_jpyc));
      const subtotalInt = priceInt * argv.qty;
      const { discount, rule } = await resolveDiscountForQuote(
        env,
        shop.slug,
        argv.discountRuleId,
        argv.product,
        subtotalInt,
      );
      if (!rule) {
        ctx.output.print(
          ctx.output.error(
            'DISCOUNT_RULE_NOT_FOUND',
            `Discount rule "${argv.discountRuleId}" not found in shop "${shop.slug}"`,
          ),
        );
        process.exit(1);
      }
      discountObject = discount;
    }

    const created = await api.createOrder(env, {
      shop_id: shop.id,
      customer_address: address,
      chain_id: chainId,
      items: [{ product_id: argv.product, quantity: argv.qty }],
      customer_name: argv.shippingName,
      customer_email: argv.shippingEmail,
      customer_note: argv.customerNote,
      shipping_prefecture: argv.shippingPrefecture,
      shipping_address1: argv.shippingAddress1,
      shipping_address2: argv.shippingAddress2,
      shipping_zip: argv.shippingZip,
      shipping_tel: argv.shippingTel,
      discount: discountObject,
    });

    const typedDataJson = buildReceiveWithAuthorizationTypedData({
      chainId: created.order.chain_id,
      fromAddress: address,
      toAddress: created.shop_wallet_address,
      totalJpyc: created.order.total_jpyc,
      validAfter: created.order.valid_after,
      validBefore: created.order.valid_before,
      nonce: created.order.nonce,
    });

    // owner モード: --passphrase が明示されていればそれを使う
    // agent モード: credential (api-key) を使う
    // どちらも未指定なら credential 解決にフォールバック（undefined なら OWS 側で復号失敗）
    const credential = ctx.credential.resolve(argv.apiKey);
    const authArg = argv.passphrase ?? credential;
    const signResult = ctx.wallet.signTypedData(
      walletId,
      `eip155:${chainId}`,
      typedDataJson,
      authArg,
    );

    // OWS SDK は `0x` プレフィックス無しで署名を返すことがあるため補正する
    const signatureHex = signResult.signature.startsWith('0x')
      ? signResult.signature
      : `0x${signResult.signature}`;

    const submitted = await api.submitSignature(
      env,
      created.order.id,
      signatureHex,
      address,
    );

    ctx.output.print(
      ctx.output.success({
        env,
        order_number: created.order.order_number,
        order_id: created.order.id,
        order_status: submitted.order_status,
        signed_at: submitted.signed_at,
        chain: argv.chain,
        chainId,
        subtotal_jpyc: created.order.subtotal_jpyc,
        discount_jpyc: created.order.discount_jpyc ?? '0',
        shipping_jpyc: created.order.shipping_jpyc,
        total_jpyc: created.order.total_jpyc,
        shop: { slug: shop.slug, name: shop.name },
        message: 'Signature submitted. Shop will collect payment on-chain shortly.',
      }),
    );
  } catch (err) {
    handleApiError(ctx, err);
  }
}

async function trackHandler(ctx: PluginContext, argv: ArgumentsCamelCase<TrackArgs>) {
  try {
    const env = normalizeEnv(argv.env);
    let address = argv.address;
    if (!address && argv.wallet) {
      address = ctx.wallet.getEvmAddress(argv.wallet);
    }
    if (!address) {
      ctx.output.print(
        ctx.output.error('VALIDATION_ERROR', 'Either --wallet or --address is required'),
      );
      process.exit(1);
    }

    const orders = await api.listOrders(env, address);
    ctx.output.print(
      ctx.output.success({
        env,
        address,
        orders,
      }),
    );
  } catch (err) {
    handleApiError(ctx, err);
  }
}

function handleApiError(ctx: PluginContext, err: unknown): never {
  if (err instanceof api.JpycEcApiError) {
    ctx.output.print(ctx.output.error(err.code, err.message));
    process.exit(1);
  }
  ctx.output.handleError(err);
}
