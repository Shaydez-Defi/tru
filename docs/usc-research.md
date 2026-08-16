# TRU — USC / Attestcoin Protocol Research Reference (verified Aug 2026)

## 1. Current testnet (CC3 Testnet) — THIS is the one to use

| Item | Value | Source |
|---|---|---|
| Network | **CC3 Testnet** (newest, active dev; "USC Testnet" and "USC Testnet 2" are dead) | https://docs.creditcoin.org/environments/testnet |
| EVM ChainId | **102031** (`0x18e8f`) — verified live via `eth_chainId` | https://chainlist.org/chain/102031 ; docs page |
| Substrate WSS RPC | `wss://rpc.cc3-testnet.creditcoin.network` | https://docs.creditcoin.org/environments/testnet |
| EVM HTTPS RPC | `https://rpc.cc3-testnet.creditcoin.network` (works; returned 102031) | used in SDK examples + live check |
| Explorer | `https://creditcoin-testnet.blockscout.com/` | https://docs.creditcoin.org/environments/testnet |
| Staking/Dashboard | `https://dashboard.cc3-testnet.creditcoin.network/` | docs page + https://github.com/gluwa/creditcoin-usc-networks |
| Faucet | **Discord** → server `creditcoin`, channel `#token-faucet`, command `/faucet address:<addr>` (supports both Substrate and EVM tCTC) | https://docs.creditcoin.org/wallets/using-testnet-faucet |
| Latest node image | `gluwa/creditcoin3:3.131.0-testnet`; min `@polkadot/api` 16.1.1; min validator bond 20000 tCTC | https://docs.creditcoin.org/environments/testnet |

## 2. @gluwa/usc-sdk — current version + actual exports

- **Latest published: 0.18.0** (published 2026-06-22, MIT). First published 2026-03-23. (npm registry + https://www.npmjs.com/package/@gluwa/usc-sdk)
- Requires **ethers v6** peer dep; deps: axios, dotenv, ethers, exponential-backoff. Repo: https://github.com/gluwa/cc-next-query-builder
- Actual exports (from `dist/index.d.ts` of 0.18.0 tarball): namespaces `encoding`, `queryBuilder`, `proofProvider`, `chainInfo`, `blockProver`, `utils`.
  - `proofProvider.service.ProofBuilder(chainKey, url)` — hosted builder: `getProof(txHash)`, `getBatchProof(hashes[])`, `waitUntilHeightAttested(chainKey, height)`. Returns `ProofResult{success, data{chainKey, headerNumber, txIndex, txHash, txBytes, merkleProof, continuityProof, cached, generatedAt}, error}`. Batch: `MAX_BATCH_SIZE` 10, `MAX_BATCH_RANGE` 1000 blocks.
  - `proofProvider.raw.RawProofBuilder` — local proof computation; `proofProvider.raw.blockProvider.SimpleBlockProvider`; `proofProvider.mergeProofs`; types `ContinuityProof{lowerEndpointDigest, roots}`.
  - `chainInfo.PrecompileChainInfoProvider(rpc)` — `getSupportedChains()`, `getSupportedChainByKey`, `getLatestAttestedHeightAndHash`, `getContinuityBounds`, etc.
  - `blockProver.PrecompileBlockProver(rpc)` — `verifySingle`, `verifyAndEmitSingle(signer,...)`, `verifyBatch`, `verifyAndEmitBatch`, `computeTransactionIndex`.
  - `encoding.abiEncode(tx, rx, EncodingVersion.V1)` (chunks common + type-specific + receipt fields), `encoding.getTransactionWithRaw`.
  - `utils.decoder.decodeEvmV1Transaction(txBytes, contract)` — on-chain decoder.
  - `queryBuilder` — QueryBuilder / QueryBuilderForEvent / QueryBuilderForFunction (extract fields/events from tx bytes).
- ⚠️ API renamed in **0.13.0** (June 2026): `proofGenerator`/`ProverAPIProofGenerator`/`RawProofGenerator`/`generateProof()` → `proofProvider`/`ProofBuilder`/`RawProofBuilder`/`getProof()`. Source: https://github.com/gluwa/creditcoin3/pull/1048

## 3. Supported source chains — Ethereum Sepolia IS supported

CC3 Testnet, **verified live** by calling the ChainInfo precompile (`0x...fd3`, selector `get_supported_chains()`):
- **chainKey 1 = Sepolia ethereum (chainId 11155111)**, encoding v1
- **chainKey 3 = Ethereum (mainnet, chainId 1)**, encoding v1

⚠️ **chainKey ≠ chainId**, and chainKey is per-environment (e.g. in stale devnet configs Sepolia is key 3). Query `getSupportedChains()` at runtime — never hardcode. Source: https://docs.creditcoin.org/attestcoin-protocol/attestcoin-protocol-chains-environments.md (Sepolia=1, ETH mainnet=3 on CC3 testnet)

## 4. Proof builder / attestation endpoint

- **Current (CC3 Testnet):** `https://prover.cc3-testnet.creditcoin.network/` and alias `https://proof-gen-api.cc3-testnet.creditcoin.network/` — both live, both redirect to `/api/swagger/`. HTTP endpoints: `/api/v1/proof-by-tx/{chainKey}/{txHash}`, `/api/v1/attested-height/{chainKey}` (verified: returned attestedHeight 11497560 for Sepolia). Source: docs page + live checks + SDK service docs.
- **CC3 Mainnet:** `https://proofbuilder.cc3-mainnet-usc.creditcoin.network/`
- **Dead/deprecated:** `prover.usc-testnet.creditcoin.network` and `rpc.usc-testnet2.creditcoin.network` (connection failed — confirms deprecation).

## 5. Required contract interface on the Creditcoin side (your TRUUniversalContract)

- **BlockProver Precompile** `0x0000000000000000000000000000000000000FD2` (formerly called "Native Query Verifier" / `INativeQueryVerifier`). Functions: `verify(chainKey, height, encodedTransaction, MerkleProof, ContinuityProof)` (view) and `verifyAndEmit(...)` (state-changing, reverts on failure, emits **`TransactionVerified(uint64 chainKey, uint64 height, uint64 transactionIndex)`**). Structs: `MerkleProof{bytes32 root, MerkleProofEntry[] siblings}` with `MerkleProofEntry{bytes32 hash, bool isLeft}`; `ContinuityProof{bytes32 lowerEndpointDigest, bytes32[] roots}`. (from SDK ABI json + ASC doc)
- **ChainInfo Precompile** `0x0000000000000000000000000000000000000fd3` — `get_supported_chains`, `is_height_attested`, bounds/checkpoint getters.
- **EvmV1Decoder contract** (used to extract events/fields from verified `txBytes`): CC3 testnet **`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f`**, mainnet **`0x9D094C9f22B10FCf842c2fC6A0981630A4F94B5C`** (verified code exists on testnet).
- **ASC pattern** (docs "Attestcoin Smart Contracts"): worker calls your contract with `(chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)` → your contract (1) computes `transactionIndex` from merkle path, (2) does **replay protection** keyed on `keccak(chainKey, blockHeight, txIndex)` (or your txHash+logIndex), (3) calls the precompile `verifyAndEmit`, (4) **MUST check receipt `status == 1`** — the precompile only proves inclusion, NOT success — (5) decodes the event you care about, (6) runs business logic. Reference impl: https://github.com/gluwa/usc-testnet-bridge-examples/blob/main/contracts/sol/USCMinter.sol ; design patterns: https://docs.creditcoin.org/attestcoin-protocol/dapp-builder-infrastructure/dapp-design-patterns-readability.md

## 6. ⚠️ Conflicting/outdated info — call-outs

1. **Terminology renamed:** "USC / Universal Smart Contract" is now **"Attestcoin Protocol" (ASC)**. Current docs live under `/attestcoin-protocol/...`. Old URLs like `docs.creditcoin.org/usc/usc-v1/quickstart` are **404 now**. Docs explicitly note repo/SDK names lag the rename. Source: https://docs.creditcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk.md
2. **Testnet migration:** Old **"USC Testnet" (EVM chainId 102033, `wss://rpc.usc-testnet.creditcoin.network`)** and **"USC Testnet 2" (`usc-testnet2`)** are dead. **CC3 Testnet (chainId 102031) is current.** Old docs (still cached by search engines, e.g. the `usc-v1/quickstart` page) list 102033 + the dead RPC — ignore them.
3. **networks.json is stale:** https://github.com/gluwa/creditcoin-usc-networks has no `cc3-testnet` entry (only usc-devnet, cc3-devnet, dryrun, and a "USC Testnet 2" entry pointing at dead `usc-testnet2` URLs). Use the docs testnet page as authority for CC3 Testnet; the repo's chainKey assignments differ per env.
4. **Two older SDK docs still show pre-0.13 names** (`ProverAPIProofGenerator`, `proofGenerator`) — the current page (`/attestcoin-protocol/.../attestcoin-sdk-usc-sdk.md`) uses `ProofBuilder`/`proofProvider`. Use 0.18.0 exports.
5. **Two proof-builder hostnames** (`prover.` and `proof-gen-api.`) both resolve on CC3 testnet — aliases, not a conflict.

## Gaps / genuinely unclear
- **Faucet** has no documented web UI or REST endpoint; only the Discord `/faucet` bot is documented. tCTC minting speed/limits are undocumented.
- No explicit documented rate limits or auth for the proof-builder API.
- Docs label all code snippets "educational, not for production"; the precompile is a native Rust runtime component (no EVM bytecode — `eth_getCode` returns empty).