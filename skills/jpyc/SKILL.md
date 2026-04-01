---
name: jpyc
description: Developer reference for JPYC (JPY-pegged stablecoin) smart contract. Use when building dApps, scripts, or integrations with JPYC token. Covers all functions including EIP-3009 gasless transfers (transferWithAuthorization, receiveWithAuthorization), EIP-2612 permit, EIP712 domain, admin operations (mint/burn/blocklist/pause), contract addresses, type hashes, and signature construction patterns.
---

# JPYC Contract Reference

## Contract Overview

JPYC is a JPY-pegged stablecoin (日本円連動ステーブルコイン) issued as a **funds transfer business (資金移動業)** token. The contract (`FiatTokenV1`) is forked from Centre's USDC implementation and deployed as a **UUPS upgradeable proxy** on multiple chains.

- **Contract name**: `FiatTokenV1`
- **Solidity version**: `0.8.11`
- **Symbol**: `JPYC` | **Decimals**: `18` | **Currency**: `JPY`

## Contract Addresses

The proxy address is the same across all chains:

| Network | Chain ID | Proxy Address |
|---|---|---|
| Ethereum | 1 | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` |
| Polygon | 137 | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` |
| Avalanche | 43114 | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` |
| Sepolia (testnet) | 11155111 | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` |
| Amoy (testnet) | 80002 | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` |
| Fuji (testnet) | 43113 | `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` |

> **Note**: Always interact with the **proxy address** above, not the implementation address.

## EIP712 Domain

```
name:              "JPY Coin"
version:           "1"
chainId:           <current chain ID>
verifyingContract: 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
```

**Domain separator is dynamic**: recomputed if `block.chainid` differs from the chain ID at initialization. The current separator can be read on-chain via `_domainSeparatorV4()` (public view function).

Domain type hash (hardcoded):
`0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f`
= `keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")`

## Type Hashes (constants)

| Constant | Value | Preimage |
|---|---|---|
| `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` | `0x7c7c6cdb...` | `TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)` |
| `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` | `0xd099cc98...` | `ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)` |
| `CANCEL_AUTHORIZATION_TYPEHASH` | `0x158b0a9e...` | `CancelAuthorization(address authorizer,bytes32 nonce)` |
| `PERMIT_TYPEHASH` | `0x6e71edae...` | `Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)` |

## Standard ERC20 Functions

```solidity
function transfer(address to, uint256 value) external returns (bool)
function transferFrom(address from, address to, uint256 value) external returns (bool)
function approve(address spender, uint256 value) external returns (bool)
function increaseAllowance(address spender, uint256 increment) external returns (bool)
function decreaseAllowance(address spender, uint256 decrement) external returns (bool)
function allowance(address owner, address spender) external view returns (uint256)
function balanceOf(address account) external view returns (uint256)
function totalSupply() external view returns (uint256)
```

All transfer/approve functions revert if: contract is paused, or either address is blocklisted.

`transferFrom` has an **infinite approval optimization**: if `allowance == type(uint256).max`, the allowance is not decremented on transfer.

## EIP-3009 Gasless Transfers

For full details → [references/eip3009.md](references/eip3009.md)

Key distinction:
- `transferWithAuthorization`: **anyone** can submit (caller ≠ `to` is fine)
- `receiveWithAuthorization`: caller **must be** `to` — prevents front-running

Nonce for EIP-3009 is `bytes32` (random, not sequential). Use `authorizationState(authorizer, nonce)` to check if used.

## EIP-2612 Permit

For full details → [references/eip2612.md](references/eip2612.md)

Nonce for permit is sequential `uint256`. Use `nonces(owner)` to read current nonce.

## Admin / Roles

For full details → [references/admin.md](references/admin.md)

| Role | Address getter | Key capability |
|---|---|---|
| `owner` | `owner()` | transferOwnership, updateMinterAdmin, updatePauser, updateBlocklister, updateRescuer, upgradeTo |
| `minterAdmin` | `minterAdmin()` | configureMinter, removeMinter |
| `minter` | `isMinter(addr)` | mint, burn |
| `pauser` | `pauser()` | pause, unpause |
| `blocklister` | `blocklister()` | blocklist, unBlocklist |
| `rescuer` | `rescuer()` | rescueERC20 |

## Events

```solidity
event Transfer(address indexed from, address indexed to, uint256 value)
event Approval(address indexed owner, address indexed spender, uint256 value)
event Mint(address indexed minter, address indexed to, uint256 amount)
event Burn(address indexed burner, uint256 amount)
event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)
event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)
event Blocklisted(address indexed _account)
event UnBlocklisted(address indexed _account)
event Pause()
event Unpause()
event MinterConfigured(address indexed minter, uint256 minterAllowedAmount)
event MinterRemoved(address indexed oldMinter)
event MinterAdminChanged(address indexed newMinterAdmin)
event BlocklisterChanged(address indexed newBlocklister)
event PauserChanged(address indexed newAddress)
event RescuerChanged(address indexed newRescuer)
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)
event Upgraded(address indexed implementation)
```

## Key Constraints

- `transfer`/`transferFrom`/`approve`: reverts when **paused** or either party **blocklisted**
- `transferFrom`: if `allowance == type(uint256).max`, allowance is **not decremented** (infinite approval)
- `mint`: requires minter role + minter allowance + not paused + not blocklisted
- `burn`: requires minter role + not paused + not blocklisted + `amount > 0` + `amount <= balance`
- The contract itself (`address(this)`) is blocklisted at initialization
- `receiveWithAuthorization`: `msg.sender` must equal `to`
- EIP-3009 nonces: random `bytes32`, not sequential; once used/canceled cannot be reused
- EIP-2612 nonces: sequential `uint256` per address

## Common Error Messages

| Error | Cause |
|---|---|
| `"Pausable: paused"` | Action attempted while contract is paused |
| `"Blocklistable: account is blocklisted"` | Blocklisted address involved in operation |
| `"FiatToken: caller is not a minter"` | mint/burn without minter role |
| `"FiatToken: caller is not the minterAdmin"` | configureMinter/removeMinter by wrong address |
| `"FiatToken: mint amount exceeds minterAllowance"` | Exceeds configured minting allowance |
| `"FiatToken: mint amount not greater than 0"` | Minting zero amount |
| `"FiatToken: burn amount not greater than 0"` | Burning zero amount |
| `"FiatToken: burn amount exceeds balance"` | Burning more than caller's balance |
| `"FiatToken: transfer amount exceeds balance"` | Insufficient balance for transfer |
| `"FiatToken: transfer amount exceeds allowance"` | Insufficient allowance for transferFrom |
| `"FiatToken: decreased allowance below zero"` | decreaseAllowance underflow |
| `"FiatToken: contract is already initialized"` | Called initialize twice |
| `"Ownable: caller is not the owner"` | Owner-only function called by other |
| `"Pausable: caller is not the pauser"` | pause/unpause by non-pauser |
| `"Blocklistable: caller is not the blocklister"` | blocklist/unBlocklist by non-blocklister |
| `"Rescuable: caller is not the rescuer"` | rescueERC20 by non-rescuer |
| `"EIP3009: invalid signature"` | Wrong signer, domain, or type hash |
| `"EIP3009: authorization is not yet valid"` | `block.timestamp <= validAfter` |
| `"EIP3009: authorization is expired"` | `block.timestamp >= validBefore` |
| `"EIP3009: authorization is used or canceled"` | Nonce already consumed |
| `"EIP3009: caller must be the payee"` | `receiveWithAuthorization`: `msg.sender != to` |
| `"EIP2612: permit is expired"` | `block.timestamp > deadline` |
| `"EIP2612: invalid signature"` | Wrong signer, nonce, or domain |
