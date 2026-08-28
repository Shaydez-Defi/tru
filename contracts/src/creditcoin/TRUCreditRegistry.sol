// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { ITRUCreditRegistry } from "./interfaces/ITRUCreditRegistry.sol";

/// @title TRUCreditRegistry
/// @notice Creditcoin-side credit history registry. Receives ONLY verified
///         repayment facts from TRUUniversalContract and updates credit profiles.
///         Per AGENTS.md rule 6 this contract contains NO proof/verification logic.
///         Credit logic (build-order step 6) is deterministic and explainable in
///         one sentence: creditLimit = baseLimit + (repayments * incrementPerRepayment),
///         with baseLimit = 0 and incrementPerRepayment = 100, both in the same
///         base unit as totalRepaid (the source chain's msg.value, i.e. wei).
contract TRUCreditRegistry is ITRUCreditRegistry {
    struct CreditProfile {
        uint256 repayments;
        uint256 totalRepaid;
        uint256 creditLimit;
    }

    // CreditState thresholds (deterministic, documented):
    //   NEW         = 0 repayments
    //   BUILDING    = 1-2 repayments
    //   ESTABLISHED = 3-5 repayments
    //   VERIFIED    = 6+ repayments
    // Do not change these thresholds without updating the comment above and the
    // corresponding Forge boundary tests.

    

    /// @dev Deterministic credit rule. Public so the formula is readable on-chain.
    uint256 public constant BASE_LIMIT = 0;
    uint256 public constant INCREMENT_PER_REPAYMENT = 100;

    address public owner;
    address public universalContract;

    mapping(address => CreditProfile) public profiles;

    /// @dev Replay protection: a queryId (keccak of chainKey, blockHeight, txIndex)
    ///      computed by TRUUniversalContract may only be recorded once.
    mapping(bytes32 => bool) public processedRepayments;

    /// @dev Duplicate protection (separate from replay): a given loanId may be
    ///      credited to a borrower's profile at most once, regardless of which
    ///      code path delivers it.
    mapping(address => mapping(uint256 => bool)) public countedLoans;

    /// @dev Verified financial event history per borrower. Append-only.
    mapping(address => VerifiedFinancialEvent[]) public borrowerEvents;

    /// @dev Loan lifecycle: per-borrower loanId status (NONE -> ACTIVE -> REPAID).
    ///      Only USC-verified originations/repayments mutate this (AGENTS.md rules 1-3).
    mapping(address => mapping(uint256 => LoanStatus)) public loanStatus;

    /// @dev Count of Active (verified originated but not yet repaid) loans per borrower.
    mapping(address => uint256) public outstandingObligations;

    /// @dev Replay protection for verified loan originations (queryId = keccak(chainKey, blockHeight, txIndex)).
    mapping(bytes32 => bool) public processedOriginations;

    /// @dev Distinct source chains where a verified origination exists for a borrower (for verifiedSourceChains gap fix).
    mapping(address => uint64[]) private borrowerOriginationChains;
    mapping(address => mapping(uint64 => bool)) private hasSeenOriginationChain;

    event RepaymentRecorded(bytes32 indexed queryId, address indexed borrower, uint256 loanId, uint256 amount);
    event LoanOriginationRecorded(bytes32 indexed queryId, address indexed borrower, uint256 indexed loanId, uint256 principal, uint256 dueTimestamp);

    modifier onlyUniversalContract() {
        require(msg.sender == universalContract, "Only TRUUniversalContract");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Sets the TRUUniversalContract allowed to record verified repayments.
    function setUniversalContract(address uc) external onlyOwner {
        universalContract = uc;
    }

    /// @notice Records a USC-verified loan origination. Callable ONLY by TRUUniversalContract.
    /// @dev Mirrors recordVerifiedRepayment pattern: same trust boundary, same replay
    ///      protection (queryId), same emitter authorization via UC. Marks loan as ACTIVE.
    function recordVerifiedLoanOrigination(
        bytes32 queryId,
        address borrower,
        uint256 loanId,
        uint256 principal,
        uint256 dueTimestamp,
        uint64 sourceChain,
        bytes32 sourceTxHash,
        uint64 sourceBlock
    ) external onlyUniversalContract {
        require(!processedOriginations[queryId], "Loan origination already recorded");
        processedOriginations[queryId] = true;

        require(loanStatus[borrower][loanId] == LoanStatus.NONE, "Loan already originated");
        loanStatus[borrower][loanId] = LoanStatus.ACTIVE;
        outstandingObligations[borrower] += 1;

        // Track distinct source chains for verifiedSourceChains (covers case where only
        // origination has been verified so far, no repayment yet).
        if (!hasSeenOriginationChain[borrower][sourceChain]) {
            hasSeenOriginationChain[borrower][sourceChain] = true;
            borrowerOriginationChains[borrower].push(sourceChain);
        }

        // Note: origination verified facts are lifecycle state (Active count), not
        // appended to borrowerEvents which remains repayment history for
        // loanHistory reuse. Principal/due are emitted for audit but not stored
        // as VerifiedFinancialEvent to keep loanHistory as repayment evidence.

        emit LoanOriginationRecorded(queryId, borrower, loanId, principal, dueTimestamp);
    }

    /// @notice Records a USC-verified repayment. Callable ONLY by TRUUniversalContract.
    /// @dev The caller is trusted to pass a correctly derived queryId; the registry
    ///      does no proof/verification work itself, it only enforces single-recording.
    function recordVerifiedRepayment(
        bytes32 queryId,
        address borrower,
        uint256 loanId,
        uint256 amount,
        uint64 sourceChain,
        bytes32 sourceTxHash,
        uint64 sourceBlock
    ) external onlyUniversalContract {
        require(!processedRepayments[queryId], "Repayment already recorded");
        processedRepayments[queryId] = true;

        // Duplicate protection: a loanId counts toward a borrower's profile once.
        require(!countedLoans[borrower][loanId], "Loan already credited");
        countedLoans[borrower][loanId] = true;

        // Loan lifecycle transition: ACTIVE -> REPAID. Edge case documented:
        // a repayment for a loanId with no verified origination on record (loanStatus == NONE)
        // is still allowed and recorded as REPAID, but outstandingObligations is not
        // decremented because no Active obligation was previously counted. This preserves
        // backward compatibility (phase 5/6 tests repay without prior origination) and
        // ensures outstanding only reflects verified Active loans. Requiring prior
        // origination would be stricter but would break existing verified repayment
        // flows that are already evidenced live.
        LoanStatus status = loanStatus[borrower][loanId];
        if (status == LoanStatus.ACTIVE) {
            loanStatus[borrower][loanId] = LoanStatus.REPAID;
            // safe decrement (should be >=1 if status was ACTIVE)
            if (outstandingObligations[borrower] > 0) {
                outstandingObligations[borrower] -= 1;
            }
        } else if (status == LoanStatus.NONE) {
            loanStatus[borrower][loanId] = LoanStatus.REPAID;
            // outstanding unchanged — no Active loan was counted
        } else {
            // status == REPAID should be unreachable due to countedLoans guard above,
            // but handle defensively
            revert("Loan already repaid");
        }

        CreditProfile storage profile = profiles[borrower];
        profile.repayments += 1;
        profile.totalRepaid += amount;
        profile.creditLimit = BASE_LIMIT + profile.repayments * INCREMENT_PER_REPAYMENT;

        // Append verified financial event record
        borrowerEvents[borrower].push(VerifiedFinancialEvent({
            eventId: queryId,
            borrower: borrower,
            sourceChain: sourceChain,
            sourceTxHash: sourceTxHash,
            sourceBlock: sourceBlock,
            loanId: loanId,
            eventType: EventType.Repayment,
            amount: amount,
            verifiedAt: block.timestamp
        }));

        emit RepaymentRecorded(queryId, borrower, loanId, amount);
    }

    /// @notice Returns the number of verified financial events for a borrower.
    function getEventCount(address borrower) external view returns (uint256) {
        return borrowerEvents[borrower].length;
    }

    /// @notice Returns a page of verified financial events for a borrower.
    /// @param borrower The borrower address to query.
    /// @param offset Starting index (0 = most recent event).
    /// @param limit Maximum number of events to return.
    /// @return events Array of VerifiedFinancialEvent records (most recent first).
    function getEvents(
        address borrower,
        uint256 offset,
        uint256 limit
    ) external view returns (VerifiedFinancialEvent[] memory) {
        VerifiedFinancialEvent[] storage events = borrowerEvents[borrower];
        uint256 total = events.length;
        if (offset >= total) {
            return new VerifiedFinancialEvent[](0);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;
        VerifiedFinancialEvent[] memory result = new VerifiedFinancialEvent[](count);
        // Return most recent first (reverse chronological)
        for (uint256 i = 0; i < count; i++) {
            result[i] = events[total - 1 - offset - i];
        }
        return result;
    }

    /// @notice Returns credit evidence for a borrower, derived entirely from
    ///         verified facts. Every field traces back to the event history or
    ///         the existing profile struct. No speculative or AI-derived field
    ///         is included.
    function getCreditEvidence(address borrower) external view returns (CreditEvidence memory) {
        CreditProfile storage profile = profiles[borrower];
        uint256 reps = profile.repayments;

        CreditState state;
        if (reps == 0) state = CreditState.NEW;
        else if (reps <= 2) state = CreditState.BUILDING;
        else if (reps <= 5) state = CreditState.ESTABLISHED;
        else state = CreditState.VERIFIED;

        // distinctLoansRepaid: count unique loanIds in the borrower's event
        // history. Derived from the phase-7 event log; no new storage.
        uint256 distinct = 0;
        VerifiedFinancialEvent[] storage evts = borrowerEvents[borrower];
        uint256 n = evts.length;
        for (uint256 i = 0; i < n; i++) {
            bool seen = false;
            for (uint256 j = 0; j < i; j++) {
                if (evts[j].loanId == evts[i].loanId) {
                    seen = true;
                    break;
                }
            }
            if (!seen) distinct++;
        }

        // failedOrRejectedEvents is definitionally 0: only USC-verified events
        // ever reach storage (AGENTS.md rules 1-3). Nothing recorded here was
        // ever a failed or rejected attempt; rejected proofs never write state.
        // We return 0 explicitly rather than fabricating a counter that could
        // imply otherwise.
        return CreditEvidence({
            creditState: state,
            repayments: profile.repayments,
            totalRepaid: profile.totalRepaid,
            creditLimit: profile.creditLimit,
            distinctLoansRepaid: distinct,
            failedOrRejectedEvents: 0
        });
    }

    /// @notice View helper to derive CreditState for a given repayment count.
    function getCreditState(uint256 repayments) external pure returns (CreditState) {
        if (repayments == 0) return CreditState.NEW;
        if (repayments <= 2) return CreditState.BUILDING;
        if (repayments <= 5) return CreditState.ESTABLISHED;
        return CreditState.VERIFIED;
    }

    function getLoanStatus(address borrower, uint256 loanId) external view returns (LoanStatus) {
        return loanStatus[borrower][loanId];
    }

    function getOutstandingObligations(address borrower) external view returns (uint256) {
        return outstandingObligations[borrower];
    }

    function getCreditPassport(address borrower) external view returns (CreditPassport memory) {
        CreditEvidence memory evidence = this.getCreditEvidence(borrower);

        // loanHistory: reuse phase-7 event data (repayment history)
        VerifiedFinancialEvent[] storage stored = borrowerEvents[borrower];
        uint256 n = stored.length;
        VerifiedFinancialEvent[] memory history = new VerifiedFinancialEvent[](n);
        for (uint256 i = 0; i < n; i++) {
            history[i] = stored[i];
        }

        // verifiedSourceChains: distinct chainKeys seen in BOTH repayment history
        // and verified originations. Fixes gap where only origination has been verified.
        uint64[] storage origChains = borrowerOriginationChains[borrower];
        uint256 m = origChains.length;
        uint64[] memory chainsTmp = new uint64[](n + m);
        uint256 chainCount = 0;
        for (uint256 i = 0; i < n; i++) {
            uint64 ck = stored[i].sourceChain;
            bool seen = false;
            for (uint256 j = 0; j < chainCount; j++) {
                if (chainsTmp[j] == ck) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                chainsTmp[chainCount] = ck;
                chainCount++;
            }
        }
        for (uint256 i = 0; i < m; i++) {
            uint64 ck = origChains[i];
            bool seen = false;
            for (uint256 j = 0; j < chainCount; j++) {
                if (chainsTmp[j] == ck) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                chainsTmp[chainCount] = ck;
                chainCount++;
            }
        }
        uint64[] memory verifiedSourceChains = new uint64[](chainCount);
        for (uint256 i = 0; i < chainCount; i++) {
            verifiedSourceChains[i] = chainsTmp[i];
        }

        return CreditPassport({
            evidence: evidence,
            loanHistory: history,
            outstandingObligations: outstandingObligations[borrower],
            verifiedSourceChains: verifiedSourceChains
        });
    }
}