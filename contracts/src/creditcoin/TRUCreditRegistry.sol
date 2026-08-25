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

    event RepaymentRecorded(bytes32 indexed queryId, address indexed borrower, uint256 loanId, uint256 amount);

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
}