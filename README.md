# jpyc-dev-reference

A [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code/plugins) providing a developer reference for JPYC — a JPY-pegged stablecoin (日本円連動ステーブルコイン). Covers smart contract functions, addresses, and signature construction for building dApps, scripts, and integrations.

## What's included

- **skills/jpyc/SKILL.md** — Contract overview, addresses, EIP712 domain, ERC20 functions, key constraints, and error messages
- **skills/jpyc/references/eip3009.md** — EIP-3009 gasless transfers (`transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization`) with TypeScript/viem examples
- **skills/jpyc/references/eip2612.md** — EIP-2612 permit (gasless approve) with TypeScript/viem examples
- **skills/jpyc/references/admin.md** — Admin roles and operations (mint, burn, pause, blocklist, rescue, upgrade)

## Coverage

| Topic | Details |
|---|---|
| Contract | `FiatTokenV1` (UUPS proxy), Solidity 0.8.11, forked from Centre USDC |
| Chains | Ethereum, Polygon, Avalanche, Sepolia, Amoy, Fuji |
| Proxy address | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` (same on all chains) |
| EIP-3009 | `transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization` |
| EIP-2612 | `permit` with sequential nonces |
| Admin | Owner, MinterAdmin, Minter, Pauser, Blocklister, Rescuer roles |

## Installation

### Via plugin marketplace (recommended)

```bash
# 1. Add the marketplace
/plugin marketplace add Mameta29/jpyc-skill

# 2. Install the plugin
/plugin install jpyc-dev-reference@Mameta29-jpyc-skill
```

### Manual installation

```bash
git clone https://github.com/Mameta29/jpyc-skill.git
mkdir -p ~/.claude/skills/jpyc
cp -r jpyc-skill/skills/jpyc/* ~/.claude/skills/jpyc/
```

## Usage

Once installed, Claude Code automatically uses this skill when you work with JPYC contracts. For example:

- "Write a script to transfer JPYC using EIP-3009"
- "How do I construct a permit signature for JPYC?"
- "What's the JPYC contract address on Polygon?"

## License

MIT
