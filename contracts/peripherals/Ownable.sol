// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

import '../interfaces/IOwnable.sol';

abstract contract Ownable is IOwnable {
    /// @inheritdoc IOwnable
    address public override owner;

    /// @inheritdoc IOwnable
    address public override pendingOwner;

    constructor(address _owner) {
        if (_owner == address(0)) revert NoOwnerZeroAddress();
        owner = _owner;
    }

    /// @inheritdoc IOwnable
    function setOwner(address _owner) external override onlyOwner {
        pendingOwner = _owner;
        emit OwnerProposal(_owner);
    }

    /// @inheritdoc IOwnable
    function acceptOwner() external override onlyPendingOwner {
        owner = pendingOwner;
        delete pendingOwner;
        emit OwnerSet(owner);
    }

    /// @notice Functions with this modifier can only be called by owner
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @notice Functions with this modifier can only be called by pendingOwner
    modifier onlyPendingOwner() {
        if (msg.sender != pendingOwner) revert OnlyPendingOwner();
        _;
    }
}
