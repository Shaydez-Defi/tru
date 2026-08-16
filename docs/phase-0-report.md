# Phase 0 — Integration Spike: Status Report

**Date**: 2026-08-16
**Status**: ✅ SUCCESS — a real Ethereum Sepolia repayment event was cryptographically
verified through Creditcoin USC (Attestcoin) and consumed on-chain by a throwaway
contract on the CC3 testnet.

## What was proven

A single end-to-end path, per the AGENTS.md build order step 1 (integration spike):

1. `TestRepayment.repay(42, 999000000)` called on **Ethereum Sepolia**
   - contract `0x9048e558b7ee928029301435fc19572941d6b3a6`
   - tx `0xbd0cdaf5ed7c37ca8472b60fc9f1fcadfd829368a943465b7951b5e2ed781c9c`
   - block `11497681`, txIndex `56`
2. Worker (`creditcoin/src/prove-and-verify.mjs`) waits for the Creditcoin
   attestation, then builds a Merkle+continuity proof via the proof builder
   (`prover.cc3-testnet.creditcoin.network`).
3. On-chain precompile (BlockProver `0x...0FD2`) `verify`/`verifyAndEmit` confirm the
   proof (eth_call `true`).
4. `SpikeConsumer.execute(...)` (CC3 testnet, `0x217E12d60158cCDdDE99dACD4305A7c91C2196Dc`)
   re-verifies via `verifyAndEmit`, decodes the receipt with the deployed
   `EvmV1Decoder`, extracts the `Repayment(address,uint256,uint256)` event, enforces
   replay protection (`queryId = keccak(chainKey, height, txIndex)`), stores the
   values, and emits `RepaymentVerified`.
   - tx `0x784bdffdc73eb426d46ff82575b1ec6de6b5b570ac13ed0a8ba7d49fc379b4ae`, block `5317027`, status 1
   - `RepaymentVerified`: chainKey=1, blockHeight=11497681, txIndex=56,
     borrower=`0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0`, loanId=42, amount=999000000
   - On-chain stored: `lastBorrower`, `lastLoanId`, `lastAmount`, `verifiedCount=1`

Timing: repay→attested ~10.8 s (first time this session ~5.4 min; thereafter cached),
submit→mined ~4.9 s.

## Root cause of the earlier failure (and the fix)

The state-changing path (`consumer.execute`) reverted with **no revert data**, so the
initial suspicion (bad proof / wrong ABI encoding / precompile behavior) was wrong.
Debugging (`VerifyProbe`, `SpikeProbe`, raw `eth_call`) isolated the culprit:

- Every USC precompile call works from a contract: `calculateTxIndex`, `verify`,
  `verifyAndEmit` (all `true`/`56`).
- `EvmV1Decoder.getTransactionType` and `decodeReceiptFields` work from a contract
  (`status=1`, 1 log).
- **`EvmV1Decoder.getLogsByEventSignature` is broken on the deployed CC3 testnet
  decoder** (`0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f`): both overloads
  (`ReceiptFields,bytes32` and `LogEntry[],bytes32`) revert with empty data on valid
  input, from EOA **and** contract callers. On-chain runtime bytecode exactly matches
  the Blockscout-verified bytecode, so this is the real deployed contract.
- The SDK itself never calls `getLogsByEventSignature` — it reads `receiptLogs` from
  `decodeTransactionTypeX` and filters in JS (`@gluwa/usc-sdk/dist/utils/decoder.js`).

Fix: `SpikeConsumer._decodeRepayment` now filters `receipt.receiptLogs` in-contract
(match `topics[0] == keccak("Repayment(...)")`, require 3 topics, borrower=topics[1],
loanId=topics[2], amount=`abi.decode(data)`). Same security properties, no reliance on
the broken function. Note the console-debugging caveat: ethers v6.17 also trips a
"read only property" decode bug on `LogEntry[]` returns, which initially masked results.

## Deliverables / files

- `docs/usc-research.md` — network/SDK/precompile/proof-builder reference (chainKey 1=Sepolia, 3=Ethereum mainnet; CC3 chainId 102031; proof-builder URL; precompile addresses).
- `contracts/src/TestRepayment.sol` — Sepolia source contract.
- `contracts/src/spike/SpikeConsumer.sol` — throwaway CC3 consumer (verify + decode + replay guard).
- `contracts/deployments/sepolia/TestRepayment.json` — deployed address + ABI.
- `creditcoin/src/prove-and-verify.mjs` — full flow worker (attestation → proof → verify → execute → parse → state check).
- `creditcoin/src/proof-check.mjs`, `deploy-consumer.mjs`, `list-chains.mjs`, `decode-tx.mjs`, `debug.mjs`.
- `contracts/src/spike/VerifyProbe.sol`, `SpikeProbe.sol` — debug probes used to isolate the decoder bug.

## Notes / open items for Phase 1+

- The spike used **throwaway** contracts and a manual worker; not yet the three
  production components (SourceLoanMarket / TRUUniversalContract / TRUCreditRegistry).
- Next build-order step (per AGENTS.md) is **step 2: prove fake/tampered/replayed
  data is rejected** before building the real contracts.
- Replay protection exists in the spike (`processedQueries` keyed by
  `keccak(chainKey,height,txIndex)`); tamper/fake rejection is not yet tested.
- `getLogsByEventSignature` on the deployed decoder should be avoided; worth
  re-checking on future testnet/decoder releases.