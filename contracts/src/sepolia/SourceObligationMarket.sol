// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title SourceObligationMarket
/// @notice Source-chain (Ethereum Sepolia) market for verifiable economic obligations.
///         Per AGENTS.md rule 6 this contract knows NOTHING about Creditcoin,
///         USC, or TRU. It only manages obligations between a requester and an
///         executor (human wallet or autonomous agent) and emits events that TRU
///         can later verify.
///         This is the minimal useful primitive for "this economic obligation
///         was actually completed" — not a task marketplace, not a reputation
///         system.
contract SourceObligationMarket {
    struct Obligation {
        uint256 id;
        address requester;
        address executor;
        uint256 value;
        uint256 deadline;
        uint8 status; // 0=NONE, 1=ACTIVE, 2=COMPLETED, 3=FAILED
    }

    event ObligationCreated(
        uint256 indexed obligationId,
        address indexed requester,
        address indexed executor,
        uint256 value,
        uint256 deadline
    );
    event ObligationCompleted(
        uint256 indexed obligationId,
        address indexed executor,
        uint256 settlementAmount
    );
    event ObligationFailed(
        uint256 indexed obligationId,
        address indexed executor
    );

    uint256 public obligationCounter;
    mapping(uint256 => Obligation) public obligations;

    /// @notice Create an obligation for an executor to fulfill.
    /// @param executor The address that must complete the obligation (human or agent wallet).
    /// @param value The economic value of the obligation (in wei, token units, or agreed units).
    /// @param deadline Timestamp after which the obligation is considered overdue.
    function createObligation(address executor, uint256 value, uint256 deadline)
        external
        returns (uint256 obligationId)
    {
        require(executor != address(0), "Executor must be set");
        require(value > 0, "Value must be > 0");
        require(deadline > block.timestamp, "Deadline must be in future");

        obligationId = obligationCounter++;
        obligations[obligationId] = Obligation({
            id: obligationId,
            requester: msg.sender,
            executor: executor,
            value: value,
            deadline: deadline,
            status: 1 // ACTIVE
        });

        emit ObligationCreated(obligationId, msg.sender, executor, value, deadline);
    }

    /// @notice Mark an obligation as completed. Only the designated executor can call.
    function completeObligation(uint256 obligationId) external {
        Obligation storage o = obligations[obligationId];
        require(o.status == 1, "Obligation not active");
        require(o.executor == msg.sender, "Not executor");
        o.status = 2; // COMPLETED
        emit ObligationCompleted(obligationId, msg.sender, o.value);
    }

    /// @notice Mark an obligation as failed. Callable by requester or executor after deadline,
    ///         or by executor immediately if they cannot fulfill. Minimal failure primitive.
    function failObligation(uint256 obligationId) external {
        Obligation storage o = obligations[obligationId];
        require(o.status == 1, "Obligation not active");
        require(o.requester == msg.sender || o.executor == msg.sender, "Not party");
        // Allow failure at any time by either party for minimal demo; production could enforce deadline.
        o.status = 3; // FAILED
        emit ObligationFailed(obligationId, o.executor);
    }
}
