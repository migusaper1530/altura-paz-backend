// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Huellas SHA-256 de versiones públicas. No certifica seguridad ni veracidad del sendero.
contract RouteRegistry is Ownable2Step {
    struct Proof { bytes32 digest; uint256 timestamp; address registeredBy; bool exists; }
    mapping(bytes32 => Proof) public proofs;
    event ProofRegistered(bytes32 indexed proofId, bytes32 digest, uint256 timestamp);
    error DuplicateProof();
    error EmptyProof();
    constructor(address initialOwner) Ownable(initialOwner) {}
    function register(bytes32 proofId, bytes32 digest) external onlyOwner {
        if (proofId == bytes32(0) || digest == bytes32(0)) revert EmptyProof();
        if (proofs[proofId].exists) revert DuplicateProof();
        proofs[proofId] = Proof(digest, block.timestamp, msg.sender, true);
        emit ProofRegistered(proofId, digest, block.timestamp);
    }
}
