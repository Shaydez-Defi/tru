// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { ITRUCreditRegistry } from "./interfaces/ITRUCreditRegistry.sol";

/// @title TRUFinancing
/// @notice Minimal credit-gated financing primitive. Reads verified credit state
///         from TRUCreditRegistry; does not verify anything itself and does not
///         disburse funds. Trust boundary unchanged: TRUFinancing trusts
///         TRUCreditRegistry's already-verified state, nothing more.
///         Deployed on Creditcoin CC3.
contract TRUFinancing {
    ITRUCreditRegistry public registry;

    // Request status: for this minimal primitive, eligibility alone constitutes
    // approval. A request that passes the creditState and creditLimit checks is
    // stored as APPROVED immediately. PENDING is defined for future extension
    // where a separate approver step might exist, but is not used here. This
    // choice is documented explicitly so it is not ambiguous (matching how phase 9
    // documented its repayment-without-origination edge case).
    enum RequestStatus {
        PENDING,
        APPROVED
    }

    struct FinancingRequest {
        address borrower;
        uint256 amount;
        uint256 timestamp;
        ITRUCreditRegistry.CreditState creditStateAtRequest;
        RequestStatus status;
    }

    mapping(address => FinancingRequest[]) private requests;

    event FinancingRequested(
        address indexed borrower,
        uint256 indexed requestId,
        uint256 amount,
        ITRUCreditRegistry.CreditState creditStateAtRequest,
        RequestStatus status
    );

    constructor(address registry_) {
        require(registry_ != address(0), "Zero registry");
        registry = ITRUCreditRegistry(registry_);
    }

    /// @notice Request financing, gated on verified credit state.
    /// @dev Threshold choice documented (same style as phase 8 tiers):
    ///      creditState >= BUILDING is required. NEW (0 repayments, zero
    ///      verified history) is not financeable. BUILDING (1-2), ESTABLISHED
    ///      (3-5), VERIFIED (6+) are eligible. This keeps the financing gate
    ///      deterministic and explainable in one sentence.
    function requestFinancing(uint256 amount) external returns (uint256 requestId) {
        ITRUCreditRegistry.CreditEvidence memory evidence = registry.getCreditEvidence(msg.sender);

        // Credit-state gate: require at least BUILDING.
        // NEW (0 verified repayments) has no history to underwrite.
        require(
            uint8(evidence.creditState) >= uint8(ITRUCreditRegistry.CreditState.BUILDING),
            "Insufficient credit state"
        );
        require(amount > 0, "Amount must be > 0");
        require(amount <= evidence.creditLimit, "Amount exceeds credit limit");

        // For this minimal primitive, meeting the gates constitutes approval.
        // Status starts at APPROVED; no separate approval step exists and no
        // funds are disbursed — this is a recorded, credit-gated request only.
        requestId = requests[msg.sender].length;
        requests[msg.sender].push(
            FinancingRequest({
                borrower: msg.sender,
                amount: amount,
                timestamp: block.timestamp,
                creditStateAtRequest: evidence.creditState,
                status: RequestStatus.APPROVED
            })
        );

        emit FinancingRequested(msg.sender, requestId, amount, evidence.creditState, RequestStatus.APPROVED);
    }

    function getFinancingRequests(address borrower) external view returns (FinancingRequest[] memory) {
        return requests[borrower];
    }

    function getFinancingRequestCount(address borrower) external view returns (uint256) {
        return requests[borrower].length;
    }
}
