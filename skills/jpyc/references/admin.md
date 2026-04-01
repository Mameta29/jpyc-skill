# Admin & Role Operations

## Role Hierarchy

```
owner
├── updateMinterAdmin(address)     → changes minterAdmin
├── updatePauser(address)          → changes pauser
├── updateBlocklister(address)     → changes blocklister
├── updateRescuer(address)         → changes rescuer
├── transferOwnership(address)     → changes owner
└── upgradeTo(address)             → upgrades implementation (UUPS)
    upgradeToAndCall(address, bytes)

minterAdmin
├── configureMinter(address minter, uint256 allowedAmount)  → add/update minter
└── removeMinter(address minter)                            → remove minter

minter
├── mint(address to, uint256 amount) → mint up to minterAllowance
└── burn(uint256 amount)             → burn from own balance

pauser
├── pause()
└── unpause()

blocklister
├── blocklist(address)
└── unBlocklist(address)

rescuer
└── rescueERC20(IERC20 tokenContract, address to, uint256 amount)
```

## Minting

```solidity
function mint(address _to, uint256 _amount) external
    whenNotPaused
    onlyMinters
    notBlocklisted(msg.sender)
    notBlocklisted(_to)
    returns (bool)
```

- Requires: caller is minter, `_amount <= minterAllowed[caller]`, `_to != address(0)`, `_amount > 0`
- Decrements `minterAllowed[caller]` by `_amount`
- Emits: `Mint(caller, _to, _amount)` + `Transfer(address(0), _to, _amount)`

```solidity
function minterAllowance(address minter) external view returns (uint256)
function isMinter(address account) external view returns (bool)
```

## Burning

```solidity
function burn(uint256 _amount) external
    whenNotPaused
    onlyMinters
    notBlocklisted(msg.sender)
```

- Caller must be a minter (minterAdmin must first `configureMinter`)
- Burns from caller's own balance
- Emits: `Burn(caller, _amount)` + `Transfer(caller, address(0), _amount)`

## Configuring Minters

```solidity
// Only minterAdmin can call
function configureMinter(address minter, uint256 minterAllowedAmount)
    external whenNotPaused onlyMinterAdmin returns (bool)

function removeMinter(address minter)
    external onlyMinterAdmin returns (bool)

function updateMinterAdmin(address _newMinterAdmin)
    external onlyOwner
```

Note: `configureMinter` reverts when paused; `removeMinter` does not.

## Pause / Unpause

```solidity
function pause() external    // onlyPauser — blocks transfers, approve, mint, burn, permit, authorizations
function unpause() external  // onlyPauser
function paused() external view returns (bool)
function pauser() external view returns (address)
function updatePauser(address _newPauser) external onlyOwner
```

When paused, the following revert: `transfer`, `transferFrom`, `approve`, `increaseAllowance`, `decreaseAllowance`, `mint`, `burn`, `permit`, `transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization`, `configureMinter`.

## Blocklist

```solidity
function blocklist(address _account) external onlyBlocklister
function unBlocklist(address _account) external onlyBlocklister
function isBlocklisted(address _account) external view returns (bool)
function blocklister() external view returns (address)
function updateBlocklister(address _newBlocklister) external onlyOwner
```

- The contract address itself is blocklisted at initialization
- Blocklisted addresses cannot send or receive tokens

## Rescue (recover stuck ERC20 tokens)

```solidity
function rescueERC20(
    IERC20 tokenContract,
    address to,
    uint256 amount
) external onlyRescuer

function rescuer() external view returns (address)
function updateRescuer(address newRescuer) external onlyOwner
```

Recovers any ERC20 token (including JPYC itself if accidentally sent to the contract) to `to`.

## UUPS Upgrade

```solidity
function upgradeTo(address newImplementation) external onlyOwner
function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyOwner
function proxiableUUID() external view returns (bytes32)
    // Returns: 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
    // = keccak256("eip1967.proxy.implementation") - 1
```

- Only `owner` can upgrade
- New implementation must be UUPS-compatible (implement `proxiableUUID`)

## Initialize (only once)

```solidity
function initialize(
    string memory tokenName,
    string memory tokenSymbol,
    string memory tokenCurrency,
    uint8 tokenDecimals,
    address newMinterAdmin,
    address newPauser,
    address newBlocklister,
    address newRescuer,
    address newOwner
) public
```

- Can only be called once (`initializedVersion == 0`)
- Sets `VERSION = "1"`, `DOMAIN_SEPARATOR`, `CHAIN_ID`, and blocklists `address(this)`

## Common Error Messages

See the comprehensive error table in [SKILL.md](../SKILL.md#common-error-messages).
