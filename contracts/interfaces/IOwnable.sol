// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4 <0.9.0;

/// @title Ownable contract
/// @notice Manages the owner role
interface IOwnable {
    // Events

    /// @notice Emitted when pendingOwner accepts to be owner
    /// @param _owner Address of the new owner
    event OwnerSet(address _owner);

    /// @notice Emitted when a new owner is proposed
    /// @param _pendingOwner Address that is proposed to be the new owner
    event OwnerProposal(address _pendingOwner);

    // Errors

    /// @notice Throws if the caller of the function is not owner
    error OnlyOwner();

    /// @notice Throws if the caller of the function is not pendingOwner
    error OnlyPendingOwner();

    /// @notice Throws if trying to set owner to zero address
    error NoOwnerZeroAddress();

    // Variables

    /// @notice Stores the owner address
    /// @return _owner The owner addresss
    function owner() external view returns (address _owner);

    /// @notice Stores the pendingOwner address
    /// @return _pendingOwner The pendingOwner addresss
    function pendingOwner() external view returns (address _pendingOwner);

    // Methods

    /// @notice Proposes a new address to be owner
    /// @param _owner The address being proposed as the new owner
    function setOwner(address _owner) external;

    /// @notice Changes the owner from the current owner to the previously proposed address
    function acceptOwner() external;
}
