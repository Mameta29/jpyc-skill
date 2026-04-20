# acli-jpyc-ec

acli 向け JPYC エコシステム統合パッケージ。npm プラグイン `@komlock-lab/jpyc-ec` と 2 つの Claude Code スキルを同梱する。

## 何ができるか

- **JPYC EC Platform での商品購入**: 自然言語で「JPYC で〇〇を買いたい」と伝えると、Claude が商品検索 → 合計見積 → 残高確認 → 署名 → 注文確定までを対話で完結。ガス代 0（EIP-3009 receiveWithAuthorization）
- **JPYC 開発者向けリファレンス**: ERC20 関数、EIP-3009 / EIP-2612 署名、admin ops（mint, burn, pause, blocklist, rescue, upgrade）の参照

## 構成

```
acli-jpyc-ec/
├── src/                          # @komlock-lab/jpyc-ec acli plugin
│   ├── index.ts                  # PluginFactory (create)
│   ├── types.ts                  # PluginContext ローカルコピー
│   ├── commands/jpyc-ec.ts       # browse / categories / reviews / nft-discounts / quote / buy / track
│   └── lib/jpyc-ec-api.ts        # JPYC EC REST client + EIP-712 typed data + 割引計算ヘルパ
├── skills/
│   ├── jpyc-ec-purchase/SKILL.md # 購入フローの対話オーケストレーション
│   └── jpyc/                     # JPYC 開発者向けリファレンス
│       ├── SKILL.md
│       └── references/{eip3009,eip2612,admin}.md
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
└── test/                         # vitest（fetch モック + staging smoke）
```

## インストール

### 1. acli プラグイン (`@komlock-lab/jpyc-ec`) — 購入コマンド

**Komlock-lab org メンバー**（GitHub Packages の `read:packages` PAT 設定済み）:

```bash
acli plugin install @komlock-lab/jpyc-ec
```

**開発中・ローカル clone から試す場合**（`hl-trade-plugin` と同じパターン）:

```bash
git clone git@github.com:Komlock-lab/acli-jpyc-ec.git ~/Projects/acli-jpyc-ec
cd ~/Projects/acli-jpyc-ec
pnpm install && pnpm build

# acli monorepo 側から link:
cd ~/Projects/acli
pnpm --filter @komlock-lab/acli add link:~/Projects/acli-jpyc-ec
```

インストール後、以下のサブコマンドが使えるようになる:

```bash
acli jpyc-ec browse [--shop <slug>] [--env production|staging]
acli jpyc-ec categories [--env]
acli jpyc-ec reviews --product <id> [--env]
acli jpyc-ec nft-discounts --shop <slug> [--env]
acli jpyc-ec quote --product <id> --qty <n> --chain <name> [--wallet <name>] [--shipping-prefecture <p>] [--discount-rule-id <id>]
acli jpyc-ec buy --wallet <name> --product <id> --qty <n> --chain <name> [--shipping-*] [--discount-rule-id <id>] [--customer-note <s>] [--env] [--api-key]
acli jpyc-ec track [--wallet <name> | --address <0x...>] [--env]
```

- `categories` / `reviews` / `nft-discounts` は閲覧系（残高・署名不要）
- `--discount-rule-id` は `nft-discounts` で得たルール UUID を指定すると割引額を自動算出して order に添付する（単一商品オーダー対応、percentage / fixed）

### 2. Claude Code スキル — 対話フロー

```bash
acli skills install Komlock-lab/acli-jpyc-ec
```

これで `~/.claude/skills/jpyc-ec-purchase/` と `~/.claude/skills/jpyc/` にスキルがリンクされ、Claude が自然言語トリガー（「JPYC で買い物」「JPYC EC」等）で自動起動する。

## 使い方

### 購入

```
ユーザー: 「JPYC で木の名刺ショップの名刺が欲しい」
Claude: acli jpyc-ec browse --shop kl-no-meishi で商品取得
       → 候補を提示「どれを何個？」
       → ユーザー回答後、acli jpyc-ec quote で合計と残高確認
       → 配送先を聞く
       → 要約してユーザー承認
       → acli jpyc-ec buy で注文 + 署名 + submit を一気通貫
       → order_number を返す
```

### 注文追跡

```bash
acli jpyc-ec track --wallet main
```

## 対応チェーン

| 環境 | チェーン |
|---|---|
| production | ethereum (1), polygon (137), avalanche (43114) |
| staging | sepolia (11155111), polygon-amoy (80002), fuji (43113) |

JPYC コントラクトは全 EVM チェーン同一アドレス（CREATE2）: `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`

## 開発

```bash
pnpm install
pnpm typecheck
pnpm test            # 単体テスト（fetch モック）
JPYC_EC_E2E=1 pnpm test   # staging の GET /shops を叩く smoke も含めて実行
pnpm build
```

## ライセンス

MIT（upstream: Mameta29/jpyc-skill）

## 参考

- JPYC EC Platform: https://ec.jpyc-service.com
- JPYC コントラクト（FSA v2）: UUPS proxy, Solidity 0.8.11, forked from Centre USDC
- EIP-3009: Transfer With Authorization
- acli: Komlock-lab の内部 CLI ツール
