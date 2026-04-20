---
name: jpyc-ec-purchase
description: JPYC EC Platform でガスレス決済で商品を購入する対話フロー。カテゴリ検索・レビュー閲覧・NFT/SBT 割引適用まで対応。"JPYC で買い物", "JPYC EC", "ショップで JPYC 決済", "JPYC ショップ" でトリガー。
user-invocable: true
disable-model-invocation: false
allowed-tools:
  - "Bash(acli jpyc-ec *)"
  - "Bash(acli balance *)"
  - "Bash(acli wallet *)"
  - "Bash(acli key *)"
  - "Bash(curl *)"
---

# JPYC EC Purchase

ユーザーが JPYC EC Platform（https://ec.jpyc-service.com）で商品を購入するフローをオーケストレーションする。決済は EIP-3009 `receiveWithAuthorization` によるガスレス署名で、購入者はガス代 0。

## 前提

- `@komlock-lab/jpyc-ec` プラグインがインストール済み（`acli init` で選択 or `acli plugin install @komlock-lab/jpyc-ec`）
- EVM ウォレットが少なくとも 1 つ（`acli wallet list` で確認、無ければ owner モードで `acli wallet create <name>`）
- 購入する chain で JPYC 残高あり（不足時は `acli send --token JPYC ... --broadcast` で調達してから再開）

### エージェントモードで運用する場合

推奨セットアップ（ポリシー + APIキー一括作成）:

```bash
acli setup-agent --name my-agent --policy policy.json
export ACLI_MODE=agent
```

credential は `setup-agent` が config に自動保存するため、環境変数 `OWS_API_KEY` の利用は **廃止済み**。`--api-key` フラグはシェル履歴に残るため非推奨。

APIキー期限（既定 90 日）が近い場合、購入前に確認:

```bash
acli key list                    # expires_at を確認
acli key rotate --name my-agent  # 失効前にローテート
```

### Credential 解決順（buy 実行時に参照される）

1. `--api-key <token>` — 明示指定（非推奨）
2. config の `credential`（`setup-agent` / `init` が自動保存。**推奨**）
3. credential 未設定 → オーナーモード（ポリシー評価なし、対話確認のみ）

## 環境の選択

| env | Base URL | 対応 chain |
|---|---|---|
| production（既定）| https://ec.jpyc-service.com | ethereum / polygon / avalanche |
| staging | https://stg-ec.jpyc-service.com | sepolia / polygon-amoy / fuji |

production と staging では受け付ける chain_id が完全に分離されている。testnet で試したい場合は `--env staging` + testnet chain を使う。JPYC コントラクトは全 EVM チェーン共通で `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`（FSA 版）。

## 購入フロー

以下を順にオーケストレーションする。**ユーザー承認なしに buy を実行しない**。

### 1. Discovery — ショップ・商品を探す

ショップ slug が未知なら一覧取得:
```bash
acli jpyc-ec browse
```

出力の `shops[]` から注目すべきフィールド:
- `available_chains` / `default_chain_id` — 支払い可能チェーン
- `free_shipping_threshold` — この金額以上で送料無料（null の場合は無し）
- `category` — ショップのカテゴリ（複数可、カンマ区切り）
- `stock_display_mode` — `"exact"`（在庫数表示） / `"low_stock_only"`（閾値未満のみ警告）/ `"hidden"`（非表示、売り切れのみ通知）

slug が分かっていれば直接商品一覧:
```bash
acli jpyc-ec browse --shop <slug>
```

出力の `products[]` から `id`, `name`, `price_jpyc`, `stock`, `requires_shipping`, `category`, `tags`, `review_avg_rating`, `review_count`, `has_nft_discount` をユーザーに提示。

#### カテゴリ・タグで絞り込みたい場合

```bash
acli jpyc-ec categories
```

出力: `shop_categories[]`, `product_categories[]`, `product_tags[]`。ユーザーの興味から絞り込みヒントを得られる。

### 2. Select — 商品・数量・チェーンを確定

ユーザーに聞く:
- どの商品を（product id）
- 数量
- どのチェーンで支払うか（ショップの `available_chains` に含まれるもの）

#### レビューを確認したい場合

```bash
acli jpyc-ec reviews --product <product-id>
```

出力の `reviews[]` は検証済み購入者のレビューのみ（`customer_address` はプライバシー保護のため一部マスク）。

#### NFT/SBT ホルダー特典を適用したい場合

商品の `has_nft_discount: true`、またはユーザーが「割引使える？」と尋ねた場合:

```bash
acli jpyc-ec nft-discounts --shop <slug>
```

出力の `discount_rules[]` を確認。各ルールの `contract_address` / `chain_id` が示す NFT/SBT をユーザーが保有していれば適用可能。`apply_to_all: true` なら全商品、`false` なら `product_ids[]` に含まれる商品のみ。

### 3. Quote — 合計と残高を計算

```bash
acli jpyc-ec quote \
  --product <id> \
  --qty <n> \
  --chain <ethereum|polygon|avalanche> \
  --wallet <wallet-name> \
  [--shipping-prefecture "東京都"] \
  [--discount-rule-id <rule-uuid>]
```

出力で確認すること:
- `subtotal_jpyc` / `discount_jpyc` / `shipping_jpyc` / `total_jpyc`
- `balance.sufficient`（残高十分か）
- `shipping_reason`（送料計算の根拠）

### 4. Confirm — ユーザーに要約して承認を求める

Claude は日本語で以下を提示してユーザーの明示的な GO を待つ:

> 以下の内容で注文します:
> - 商品: {name} × {qty}
> - 合計: {total_jpyc} JPYC（小計 {subtotal} − 割引 {discount} + 送料 {shipping}）
> - 支払い: {chain} から {wallet-name} で
> - 配送先: {prefecture} {address1}{address2} 〒{zip} tel: {tel}
> - 割引ルール: {rule-name} ({rule-id})  ← 適用する場合のみ
>
> よろしければ「OK」「進めて」等とお答えください。

### 5. Buy — 注文 → 署名 → submit を 1 コマンドで

配送不要な商品:
```bash
acli jpyc-ec buy \
  --wallet <wallet-name> \
  --product <id> \
  --qty <n> \
  --chain <chain> \
  [--discount-rule-id <rule-uuid>]
```

配送必要な商品（`requires_shipping: true`）:
```bash
acli jpyc-ec buy \
  --wallet <wallet-name> \
  --product <id> \
  --qty <n> \
  --chain <chain> \
  --shipping-name "山田太郎" \
  --shipping-email "user@example.com" \
  --shipping-prefecture "東京都" \
  --shipping-address1 "渋谷区神南1-2-3" \
  --shipping-address2 "ABCビル 101" \
  --shipping-zip "150-0041" \
  --shipping-tel "03-1234-5678" \
  [--customer-note "置き配希望"] \
  [--discount-rule-id <rule-uuid>]
```

成功時のレスポンスで確認:
- `order_number`（ORD-XXXXXX 形式）
- `order_status: 2`（署名完了・回収待ち）
- `total_jpyc` / `discount_jpyc`（割引適用時）

### 6. Track — 注文追跡

```bash
acli jpyc-ec track --wallet <wallet-name>
```

出力の `orders[].discount_jpyc` で割引適用履歴も確認できる。

`order_status` の意味:

| status | 状態 |
|---|---|
| 1 | Created（署名前、通常ここで止まらない）|
| 2 | Signed（回収待ち、通常ここに到達）|
| 3 | Collected（ショップが回収済み、発送手配中）|
| 9 | Expired / Cancelled（3 日経過で自動キャンセル）|

## 対話例

### 配送必要な商品の例（NFT 割引あり）

ユーザー: 「JPYC で木の名刺ショップの名刺が欲しい」

1. `acli jpyc-ec browse --shop kl-no-meishi` で商品一覧取得
2. 商品を提示、`has_nft_discount: true` があればレビューも `acli jpyc-ec reviews --product <id>` で案内
3. 候補商品を絞ったら、`acli jpyc-ec nft-discounts --shop kl-no-meishi` で割引ルール提示し、ユーザーに「このSBT持っていますか？」と確認
4. `available_chains` を見て「polygon と avalanche のどちらで支払いますか？」
5. 配送先を聞く（prefecture / address1 / zip / tel / name / email）
6. `acli jpyc-ec quote --discount-rule-id ...` で合計と残高
7. 要約してユーザー承認を求める（上記 Confirm テンプレート）
8. OK で `acli jpyc-ec buy --discount-rule-id ...` 実行
9. `order_number` と「ショップ側で回収次第発送されます」を返す

### 配送先情報が不足している場合

`requires_shipping: true` なのにユーザーが「これ買って」とだけ伝えた場合、buy を実行せず以下を聞く:

- 都道府県
- 市区町村 + 番地（address1）
- マンション名など（address2, 任意）
- 郵便番号（zip）
- 電話番号（tel）
- お名前（customer_name）
- 通知用メール（customer_email）

揃ったら Quote → Confirm → Buy へ。

### 配送不要（デジタル商品）

`requires_shipping: false` の場合は配送先を尋ねない。quote も `--shipping-prefecture` 不要。

### 残高不足で中断する場合

`quote` で `balance.sufficient: false` が返ったら buy に進まず:

```bash
# 残高確認
acli balance --name <wallet-name> --chain <chain> --token JPYC
# 別ウォレットから送金（例: polygon）
acli send --name <source-wallet> --to <customer-address> --amount <n> --token JPYC --chain polygon --broadcast
```

を案内してから再度 quote。

## エラー対応

| code | 意味・対処 |
|---|---|
| `INVALID_CHAIN` | production に testnet chain（sepolia 等）を渡した / ショップの available_chains に無い chain を指定。`--env` とチェーン名を見直す |
| `INSUFFICIENT_BALANCE` | JPYC 不足。`acli balance --chain <c> --token JPYC --name <wallet>` で確認し、別途送金してから再開 |
| `INSUFFICIENT_STOCK` | 在庫切れ。他の商品を提案 |
| `ADDRESS_MISMATCH` | 署名した address と注文の customer_address が不一致。同じウォレットで再署名 |
| `SIGNATURE_EXPIRED` | 署名期限切れ（既定 3 日）。retry せず新しく buy を発行 |
| `INVALID_SIGNATURE` | 署名フォーマット不正。プラグイン側のバグ可能性（再試行で解消しない場合はレポート）|
| `SHOP_NOT_FOUND` / `PRODUCT_NOT_FOUND` | slug / id の typo。browse で再確認 |
| `VALIDATION_ERROR` | 必須フィールド不足（配送先等）。エラーメッセージの missing を補完して再実行 |
| `RATE_LIMITED` | 10 req/min/IP 超過。60 秒待って再実行 |
| `BALANCE_CHECK_FAILED` | オンチェーン残高参照失敗。時間を置いて再試行 |
| `KEY_EXPIRED`（acli 側）| APIキー期限切れ。`acli key rotate --name <agent>` で更新してから再実行 |
| `POLICY_DENIED`（acli 側）| ポリシールール違反（chain / token / 金額上限）。オーナーに相談 |

## 注意

- **Production と Staging の chain は完全分離**: 混ぜるとすべて `INVALID_CHAIN`
- **署名期限**: 既定 3 日。期限内に submit できなければ注文は自動キャンセルされ在庫も復元される
- **ガス代**: 購入者 0。ショップがオンチェーン回収時に負担
- **最低注文金額**: 100 JPYC
- **rate limit**: order 作成は 10 req/min/IP
- **プラットフォーム手数料**: 1%（合計に既に反映済み、購入者追加負担なし）
- **支払い形式**: EIP-3009 `receiveWithAuthorization`（オフチェーン署名のみ、オンチェーン TX はショップ側）
- **JPYC Contract**: 全チェーン共通 `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`（FSA 資金移動業版）
- **EIP-712 domain**: name=`"JPY Coin"`, version=`"1"`（プラグインが自動設定。手動署名時も厳密に一致させる）

## 非対応ケース

以下は本スキルで処理しない（ユーザーに伝える）:
- ショップ開設・運営（`jpyc-ec-owner` スキルで別途扱う予定）
- レビュー投稿（ショップ側の別フロー）
- 返品・返金（各ショップの返品ポリシーに従う）
- NFT/SBT の実際の保有チェック（`nft-discounts` ルール表示まで。保有検証はサーバ側で実施）
