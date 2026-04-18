---
name: jpyc-ec-purchase
description: JPYC EC Platform でガスレス決済で商品を購入する対話フロー。"JPYC で買い物", "JPYC EC", "ショップで JPYC 決済", "JPYC ショップ" でトリガー。
user-invocable: true
disable-model-invocation: false
allowed-tools:
  - "Bash(acli jpyc-ec *)"
  - "Bash(acli balance *)"
  - "Bash(acli wallet *)"
---

# JPYC EC Purchase

ユーザーが JPYC EC Platform（https://ec.jpyc-service.com）で商品を購入するフローをオーケストレーションする。決済は EIP-3009 `receiveWithAuthorization` によるガスレス署名で、購入者はガス代 0。

## 前提

- `@komlock-lab/jpyc-ec` プラグインがインストール済み（`acli init` で選択 or `acli plugin install @komlock-lab/jpyc-ec`）
- `acli wallet create <name>` で EVM ウォレットを 1 つ以上作成済み
- JPYC 残高あり（不足時は `acli send` で調達してから再開）

## 環境の選択

| env | Base URL | 対応 chain |
|---|---|---|
| production（既定）| https://ec.jpyc-service.com | ethereum / polygon / avalanche |
| staging | https://stg-ec.jpyc-service.com | sepolia / polygon-amoy / fuji |

production と staging では受け付ける chain_id が完全に分離されている。testnet で試したい場合は `--env staging` + testnet chain を使う。

## 購入フロー

以下を順にオーケストレーションする。**ユーザー承認なしに buy を実行しない**。

### 1. Discovery — ショップ・商品を探す

ショップ slug が未知なら一覧取得:
```bash
acli jpyc-ec browse
```

slug が分かっていれば直接商品一覧:
```bash
acli jpyc-ec browse --shop <slug>
```

出力の `products[]` から `id`, `name`, `price_jpyc`, `stock`, `requires_shipping` をユーザーに提示。

### 2. Select — 商品・数量・チェーンを確定

ユーザーに聞く:
- どの商品を（product id）
- 数量
- どのチェーンで支払うか（ショップの `available_chains` に含まれるもの）

### 3. Quote — 合計と残高を計算

```bash
acli jpyc-ec quote \
  --product <id> \
  --qty <n> \
  --chain <ethereum|polygon|avalanche> \
  --wallet <wallet-name> \
  [--shipping-prefecture "東京都"]
```

出力で確認すること:
- `total_jpyc`（送料込み合計）
- `balance.sufficient`（残高十分か）
- `shipping_reason`（送料計算の根拠）

### 4. Confirm — ユーザーに要約して承認を求める

Claude は日本語で以下を提示してユーザーの明示的な GO を待つ:

> 以下の内容で注文します:
> - 商品: {name} × {qty}
> - 合計: {total_jpyc} JPYC（小計 {subtotal} + 送料 {shipping}）
> - 支払い: {chain} から {wallet-name} で
> - 配送先: {prefecture} {address1}{address2} 〒{zip} tel: {tel}
>
> よろしければ「OK」「進めて」等とお答えください。

### 5. Buy — 注文 → 署名 → submit を 1 コマンドで

配送不要な商品:
```bash
acli jpyc-ec buy \
  --wallet <wallet-name> \
  --product <id> \
  --qty <n> \
  --chain <chain>
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
  --shipping-tel "03-1234-5678"
```

成功時のレスポンスで確認:
- `order_number`（ORD-XXXXXX 形式）
- `order_status: 2`（署名完了・回収待ち）

### 6. Track — 注文追跡

```bash
acli jpyc-ec track --wallet <wallet-name>
```

`order_status` の意味:

| status | 状態 |
|---|---|
| 1 | Created（署名前、通常ここで止まらない）|
| 2 | Signed（回収待ち、通常ここに到達）|
| 3 | Collected（ショップが回収済み、発送手配中）|
| 9 | Expired / Cancelled（3 日経過で自動キャンセル）|

## 対話例

### 配送必要な商品の例

ユーザー: 「JPYC で木の名刺ショップの名刺が欲しい」

1. `acli jpyc-ec browse --shop kl-no-meishi` で商品一覧取得
2. 商品を提示し、どれを何個買うか聞く
3. `available_chains` を見て「polygon と avalanche のどちらで支払いますか？」
4. 配送先を聞く（prefecture / address1 / zip / tel / name / email）
5. `acli jpyc-ec quote` で合計と残高
6. 要約してユーザー承認を求める（上記 Confirm テンプレート）
7. OK で `acli jpyc-ec buy` 実行
8. `order_number` と「ショップ側で回収次第発送されます」を返す

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

## エラー対応

| code | 意味・対処 |
|---|---|
| `INVALID_CHAIN` | production に testnet chain（sepolia 等）を渡した / ショップの available_chains に無い chain を指定。`--env` とチェーン名を見直す |
| `INSUFFICIENT_BALANCE` | JPYC 不足。`acli balance --chain <c> --token JPYC --address <addr>` で確認し、別途送金してから再開 |
| `INSUFFICIENT_STOCK` | 在庫切れ。他の商品を提案 |
| `SIGNATURE_EXPIRED` | 署名期限切れ（既定 3 日）。retry せず新しく buy を発行 |
| `SHOP_NOT_FOUND` / `PRODUCT_NOT_FOUND` | slug / id の typo。browse で再確認 |
| `VALIDATION_ERROR` | 必須フィールド不足（配送先等）。エラーメッセージの missing を補完して再実行 |
| `RATE_LIMITED` | 10 req/min/IP 超過。60 秒待って再実行 |

## 注意

- **Production と Staging の chain は完全分離**: 混ぜるとすべて `INVALID_CHAIN`
- **署名期限**: 既定 3 日。期限内に submit できなければ注文は自動キャンセルされ在庫も復元される
- **ガス代**: 購入者 0。ショップがオンチェーン回収時に負担
- **最低注文金額**: 100 JPYC
- **rate limit**: order 作成は 10 req/min/IP
- **プラットフォーム手数料**: 1%（合計に既に反映済み、購入者追加負担なし）
- **支払い形式**: EIP-3009 `receiveWithAuthorization`（オフチェーン署名のみ、オンチェーン TX はショップ側）

## 非対応ケース

以下は本スキルで処理しない（ユーザーに伝える）:
- ショップ開設・運営（`jpyc-ec-owner` スキルで別途扱う予定）
- NFT/SBT 特典の受取（ショップ側の設定次第）
- 返品・返金（各ショップの返品ポリシーに従う）
