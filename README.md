# JPYC Skill for Claude Code

A [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) that provides comprehensive JPYC smart contract reference for building dApps, scripts, and integrations.

## What's included

- **SKILL.md** — Contract overview, addresses, EIP712 domain, ERC20 functions, key constraints, and error messages
- **references/eip3009.md** — EIP-3009 gasless transfers (`transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization`) with TypeScript/viem examples
- **references/eip2612.md** — EIP-2612 permit (gasless approve) with TypeScript/viem examples
- **references/admin.md** — Admin roles and operations (mint, burn, pause, blocklist, rescue, upgrade)

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

```bash
claude skill install shineikikkawa/jpyc-skill
```

Or manually copy the `SKILL.md` and `references/` directory into your `.claude/skills/jpyc/` directory.

## Usage

Once installed, Claude Code automatically uses this skill when you work with JPYC contracts. For example:

- "Write a script to transfer JPYC using EIP-3009"
- "How do I construct a permit signature for JPYC?"
- "What's the JPYC contract address on Polygon?"

## License

MIT
