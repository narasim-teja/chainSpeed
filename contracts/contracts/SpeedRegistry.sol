// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SpeedRegistry
 * @dev Smart contract for recording tamper-proof speed checkpoints on Flow blockchain
 */
contract SpeedRegistry {
    
    struct Checkpoint {
        bytes32 merkleRoot;      // Root hash of 30-second speed data
        uint256 startTime;       // Checkpoint start timestamp
        uint256 endTime;         // Checkpoint end timestamp
        uint8 avgSpeed;          // Average speed (mph) 
        uint8 maxSpeed;          // Maximum speed (mph)
        uint8 minSpeed;          // Minimum speed (mph)
        uint16 distanceMeters;   // Distance covered in meters
        uint16 recordCount;      // Number of records in checkpoint
        address deviceAddress;   // Device/user address
        bytes32 deviceAttestation; // Device attestation hash
    }
    
    // Mapping from device address to their checkpoints
    mapping(address => Checkpoint[]) public deviceCheckpoints;
    
    // Mapping from merkle root to checkpoint (for quick lookup)
    mapping(bytes32 => Checkpoint) public checkpointByRoot;
    
    // Total number of checkpoints stored
    uint256 public totalCheckpoints;
    
    // Events
    event CheckpointSubmitted(
        address indexed device,
        bytes32 indexed merkleRoot,
        uint256 startTime,
        uint256 endTime,
        uint8 avgSpeed,
        uint8 maxSpeed
    );
    
    event ProofRequested(
        address indexed device,
        bytes32 indexed merkleRoot,
        uint256 requestTime
    );

    /**
     * @dev Submit a new speed checkpoint to the blockchain
     * @param checkpoint The checkpoint data to store
     */
    function submitCheckpoint(Checkpoint memory checkpoint) external {
        require(checkpoint.merkleRoot != bytes32(0), "Invalid merkle root");
        require(checkpoint.startTime > 0, "Invalid start time");
        require(checkpoint.endTime > checkpoint.startTime, "Invalid end time");
        require(checkpoint.recordCount > 0, "No records in checkpoint");
        
        // Set the device address to the caller
        checkpoint.deviceAddress = msg.sender;
        
        // Store the checkpoint
        deviceCheckpoints[msg.sender].push(checkpoint);
        checkpointByRoot[checkpoint.merkleRoot] = checkpoint;
        totalCheckpoints++;
        
        emit CheckpointSubmitted(
            msg.sender,
            checkpoint.merkleRoot,
            checkpoint.startTime,
            checkpoint.endTime,
            checkpoint.avgSpeed,
            checkpoint.maxSpeed
        );
    }

    /**
     * @dev Get all checkpoints for a specific device
     * @param device The device address
     * @return Array of checkpoints
     */
    function getDeviceCheckpoints(address device) external view returns (Checkpoint[] memory) {
        return deviceCheckpoints[device];
    }
    
    /**
     * @dev Get checkpoints for a device within a time range
     * @param device The device address
     * @param startTime Filter start time
     * @param endTime Filter end time
     * @return Array of checkpoints within the time range
     */
    function getDeviceCheckpointsInRange(
        address device,
        uint256 startTime,
        uint256 endTime
    ) external view returns (Checkpoint[] memory) {
        Checkpoint[] memory allCheckpoints = deviceCheckpoints[device];
        
        // Count matching checkpoints first
        uint256 matchCount = 0;
        for (uint256 i = 0; i < allCheckpoints.length; i++) {
            if (allCheckpoints[i].startTime >= startTime && 
                allCheckpoints[i].endTime <= endTime) {
                matchCount++;
            }
        }
        
        // Create result array
        Checkpoint[] memory result = new Checkpoint[](matchCount);
        uint256 resultIndex = 0;
        
        for (uint256 i = 0; i < allCheckpoints.length; i++) {
            if (allCheckpoints[i].startTime >= startTime && 
                allCheckpoints[i].endTime <= endTime) {
                result[resultIndex] = allCheckpoints[i];
                resultIndex++;
            }
        }
        
        return result;
    }

    /**
     * @dev Get a specific checkpoint by its merkle root
     * @param merkleRoot The merkle root hash
     * @return The checkpoint data
     */
    function getCheckpointByRoot(bytes32 merkleRoot) external view returns (Checkpoint memory) {
        require(checkpointByRoot[merkleRoot].merkleRoot != bytes32(0), "Checkpoint not found");
        return checkpointByRoot[merkleRoot];
    }

    /**
     * @dev Verify a Merkle proof against a stored checkpoint
     * @param merkleRoot The root hash of the checkpoint
     * @param proof Array of sibling hashes
     * @param leaf The leaf to verify
     * @param indices Array of indices indicating left/right positions
     * @return True if the proof is valid
     */
    function verifyMerkleProof(
        bytes32 merkleRoot,
        bytes32[] memory proof,
        bytes32 leaf,
        uint256[] memory indices
    ) external view returns (bool) {
        require(checkpointByRoot[merkleRoot].merkleRoot != bytes32(0), "Checkpoint not found");
        require(proof.length == indices.length, "Proof and indices length mismatch");
        
        bytes32 computedHash = leaf;
        
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            
            if (indices[i] % 2 == 0) {
                // Sibling is left, current hash is right
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            } else {
                // Sibling is right, current hash is left
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            }
        }
        
        return computedHash == merkleRoot;
    }

    /**
     * @dev Request a proof for legal proceedings (emits event)
     * @param merkleRoot The checkpoint to request proof for
     */
    function requestProofForLegal(bytes32 merkleRoot) external {
        require(checkpointByRoot[merkleRoot].merkleRoot != bytes32(0), "Checkpoint not found");
        
        emit ProofRequested(
            checkpointByRoot[merkleRoot].deviceAddress,
            merkleRoot,
            block.timestamp
        );
    }

    /**
     * @dev Get the number of checkpoints for a device
     * @param device The device address
     * @return Number of checkpoints
     */
    function getDeviceCheckpointCount(address device) external view returns (uint256) {
        return deviceCheckpoints[device].length;
    }

    /**
     * @dev Get device statistics
     * @param device The device address
     * @return totalDistance Total distance driven in meters
     * @return totalTime Total time driving in seconds
     * @return maxRecordedSpeed Highest speed ever recorded
     * @return checkpointCount Total number of checkpoints
     */
    function getDeviceStats(address device) external view returns (
        uint256 totalDistance,
        uint256 totalTime,
        uint8 maxRecordedSpeed,
        uint256 checkpointCount
    ) {
        Checkpoint[] memory checkpoints = deviceCheckpoints[device];
        
        totalDistance = 0;
        totalTime = 0;
        maxRecordedSpeed = 0;
        checkpointCount = checkpoints.length;
        
        for (uint256 i = 0; i < checkpoints.length; i++) {
            totalDistance += checkpoints[i].distanceMeters;
            totalTime += (checkpoints[i].endTime - checkpoints[i].startTime);
            if (checkpoints[i].maxSpeed > maxRecordedSpeed) {
                maxRecordedSpeed = checkpoints[i].maxSpeed;
            }
        }
    }
}