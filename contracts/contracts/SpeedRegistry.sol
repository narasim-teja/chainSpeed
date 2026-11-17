// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title SpeedRegistry (v2)
 * @notice Stores speed checkpoints signed by a device's Secure Enclave key.
 *
 * A registrar (the server that verifies Apple App Attest) registers one P-256
 * public key per wallet. Every checkpoint must be signed by that key, follow
 * the previous checkpoint in sequence, and be submitted within minutes of the
 * window it describes. See docs/identity-design.md.
 */
contract SpeedRegistry {
    /// Domain separator for checkpoint digests. Bump the version if the payload changes.
    bytes32 public constant CHECKPOINT_TYPEHASH = keccak256("ChainSpeed.Checkpoint.v2");

    /// A checkpoint must land on chain within this long after its window ends.
    uint256 public constant MAX_SUBMIT_DELAY = 10 minutes;
    /// Tolerance for a device clock slightly ahead of block time.
    uint256 public constant MAX_CLOCK_SKEW = 60;
    /// Longest window a single checkpoint may cover (app checkpoints are 30s).
    uint256 public constant MAX_WINDOW = 10 minutes;
    /// About 100 mph. Distances above this for the window are physically implausible.
    uint256 public constant MAX_METERS_PER_SECOND = 45;
    /// GPS jitter allowances when checking distance against the checkpoint's average speed.
    uint256 public constant SPEED_TOLERANCE_MPH = 5;
    uint256 public constant DISTANCE_TOLERANCE_METERS = 50;

    /// What the device signs (together with chain, contract and device address).
    struct CheckpointInput {
        uint64 seq;
        bytes32 prevRoot;
        bytes32 merkleRoot;
        uint64 startTime;
        uint64 endTime;
        uint8 avgSpeed;
        uint8 maxSpeed;
        uint8 minSpeed;
        uint16 distanceMeters;
        uint16 recordCount;
    }

    /// What the registry stores.
    struct Checkpoint {
        bytes32 merkleRoot;
        uint64 startTime;
        uint64 endTime;
        uint8 avgSpeed;
        uint8 maxSpeed;
        uint8 minSpeed;
        uint16 distanceMeters;
        uint16 recordCount;
        address deviceAddress;
        uint64 seq;
        bytes32 prevRoot;
        uint64 submittedAt;
        bytes32 keyHash; // keccak256(qx, qy) of the key that signed it
    }

    /// One speed record as committed in a checkpoint's Merkle tree (services/identity/recordTree.ts).
    struct RecordLeaf {
        uint64 timestampMs;
        int32 latE6;
        int32 lonE6;
        uint32 speedCentiMph;
        uint32 accuracyCm;
        bytes32 salt; // random per record, kept on the device; stops siblings being brute-forced
    }

    struct DeviceKey {
        bytes32 qx;
        bytes32 qy;
        bool active;
    }

    address public owner;
    address public registrar;

    mapping(address => DeviceKey) public deviceKeys;
    mapping(address => uint64) public lastSeq;
    mapping(address => bytes32) public lastRoot;
    mapping(address => uint64) public lastEndTime;

    mapping(address => Checkpoint[]) public deviceCheckpoints;
    /// (device, root) → 1-based index into deviceCheckpoints. Keyed by device so no one can
    /// overwrite what another device's root resolves to (F5), and nothing is stored twice.
    mapping(address => mapping(bytes32 => uint256)) private rootIndex;
    uint256 public totalCheckpoints;

    event RegistrarChanged(address indexed previous, address indexed current);
    event DeviceRegistered(address indexed device, bytes32 indexed keyHash);
    event DeviceRevoked(address indexed device, bytes32 indexed keyHash);
    event CheckpointSubmitted(
        address indexed device,
        bytes32 indexed merkleRoot,
        uint64 seq,
        uint64 startTime,
        uint64 endTime,
        uint8 avgSpeed,
        uint8 maxSpeed
    );
    event ProofRequested(address indexed device, bytes32 indexed merkleRoot, uint256 requestTime);

    error NotOwner();
    error NotRegistrar();
    error ZeroAddress();
    error InvalidPublicKey();
    error DeviceNotRegistered(address device);
    error InvalidMerkleRoot();
    error DuplicateRoot(bytes32 root);
    error NoRecords();
    error OutOfSequence(uint64 expected, uint64 got);
    error WrongPrevRoot(bytes32 expected, bytes32 got);
    error InvalidWindow();
    error OverlapsPrevious(uint64 lastEnd, uint64 start);
    error FutureWindow();
    error StaleCheckpoint();
    error ImpossibleDistance();
    error InconsistentSpeeds();
    error DistanceExceedsAverageSpeed();
    error InvalidSignature();
    error CheckpointNotFound();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    constructor(address _registrar) {
        if (_registrar == address(0)) revert ZeroAddress();
        owner = msg.sender;
        registrar = _registrar;
        emit RegistrarChanged(address(0), _registrar);
    }

    // ---------------------------------------------------------------------
    // Device registration
    // ---------------------------------------------------------------------

    function setRegistrar(address _registrar) external onlyOwner {
        if (_registrar == address(0)) revert ZeroAddress();
        emit RegistrarChanged(registrar, _registrar);
        registrar = _registrar;
    }

    /**
     * @notice Bind a Secure Enclave public key to a wallet. Called by the
     * registrar after it verifies the App Attest attestation and the user's
     * Privy session. Replacing a key starts a new checkpoint chain, but the
     * new chain may not overlap time already covered by the old one.
     */
    function registerDevice(address device, bytes32 qx, bytes32 qy) external onlyRegistrar {
        if (device == address(0)) revert ZeroAddress();
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidPublicKey();

        deviceKeys[device] = DeviceKey({qx: qx, qy: qy, active: true});
        lastSeq[device] = 0;
        lastRoot[device] = bytes32(0);
        // lastEndTime is deliberately kept so a new key cannot backfill old windows.

        emit DeviceRegistered(device, keccak256(abi.encode(qx, qy)));
    }

    function revokeDevice(address device) external onlyRegistrar {
        DeviceKey storage key = deviceKeys[device];
        if (!key.active) revert DeviceNotRegistered(device);
        key.active = false;
        emit DeviceRevoked(device, keccak256(abi.encode(key.qx, key.qy)));
    }

    // ---------------------------------------------------------------------
    // Checkpoints
    // ---------------------------------------------------------------------

    /// @notice The digest the device's enclave key must sign for `cp`.
    function checkpointDigest(address device, CheckpointInput calldata cp) public view returns (bytes32) {
        return keccak256(abi.encode(CHECKPOINT_TYPEHASH, block.chainid, address(this), device, cp));
    }

    /**
     * @notice Submit a checkpoint signed by `device`'s registered key.
     * The signature binds the device, so anyone (e.g. a gas relayer) may submit it.
     */
    function submitCheckpoint(address device, CheckpointInput calldata cp, bytes32 r, bytes32 s) external {
        DeviceKey memory key = deviceKeys[device];
        if (!key.active) revert DeviceNotRegistered(device);

        if (cp.merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (rootIndex[device][cp.merkleRoot] != 0) revert DuplicateRoot(cp.merkleRoot);
        if (cp.recordCount == 0) revert NoRecords();

        // Chain position: no insertion, deletion, reordering or replay.
        uint64 expectedSeq = lastSeq[device] + 1;
        if (cp.seq != expectedSeq) revert OutOfSequence(expectedSeq, cp.seq);
        if (cp.prevRoot != lastRoot[device]) revert WrongPrevRoot(lastRoot[device], cp.prevRoot);

        // Time: block.timestamp is the trusted clock, not the phone.
        if (cp.endTime <= cp.startTime || cp.endTime - cp.startTime > MAX_WINDOW) revert InvalidWindow();
        if (cp.startTime < lastEndTime[device]) revert OverlapsPrevious(lastEndTime[device], cp.startTime);
        if (cp.endTime > block.timestamp + MAX_CLOCK_SKEW) revert FutureWindow();
        if (block.timestamp > cp.endTime + MAX_SUBMIT_DELAY) revert StaleCheckpoint();

        // Physical plausibility.
        if (cp.minSpeed > cp.avgSpeed || cp.avgSpeed > cp.maxSpeed) revert InconsistentSpeeds();
        uint256 window = cp.endTime - cp.startTime;
        if (uint256(cp.distanceMeters) > window * MAX_METERS_PER_SECOND) revert ImpossibleDistance();
        // The distance must match the checkpoint's AVERAGE speed (what XP uses to decide "safe"),
        // so a "0 mph" average cannot carry 27 km of safe miles. 1 mph = 0.44704 m/s. The 5 mph and
        // 50 m allowances absorb GPS jitter at a standstill and very short windows.
        if (
            uint256(cp.distanceMeters) * 100_000 >
            (uint256(cp.avgSpeed) + SPEED_TOLERANCE_MPH) * 44_704 * window + DISTANCE_TOLERANCE_METERS * 100_000
        ) {
            revert DistanceExceedsAverageSpeed();
        }

        // verifySolidity, not verify: P256.verify first tries the RIP-7212 precompile at 0x100.
        // On Hedera, 0x100 is a system account (0.0.256) and a call to it consumes all forwarded
        // gas, leaving too little for the Solidity fallback. Found on Hedera testnet; see the
        // "gas-burning 0x100" test.
        if (!P256.verifySolidity(checkpointDigest(device, cp), r, s, key.qx, key.qy)) revert InvalidSignature();

        Checkpoint storage c = deviceCheckpoints[device].push();
        c.merkleRoot = cp.merkleRoot;
        c.startTime = cp.startTime;
        c.endTime = cp.endTime;
        c.avgSpeed = cp.avgSpeed;
        c.maxSpeed = cp.maxSpeed;
        c.minSpeed = cp.minSpeed;
        c.distanceMeters = cp.distanceMeters;
        c.recordCount = cp.recordCount;
        c.deviceAddress = device;
        c.seq = cp.seq;
        c.prevRoot = cp.prevRoot;
        c.submittedAt = uint64(block.timestamp);
        c.keyHash = keccak256(abi.encode(key.qx, key.qy));

        rootIndex[device][cp.merkleRoot] = deviceCheckpoints[device].length;
        lastSeq[device] = cp.seq;
        lastRoot[device] = cp.merkleRoot;
        lastEndTime[device] = cp.endTime;
        totalCheckpoints++;

        emit CheckpointSubmitted(device, cp.merkleRoot, cp.seq, cp.startTime, cp.endTime, cp.avgSpeed, cp.maxSpeed);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    function getDeviceCheckpoints(address device) external view returns (Checkpoint[] memory) {
        return deviceCheckpoints[device];
    }

    function getDeviceCheckpointsInRange(
        address device,
        uint256 startTime,
        uint256 endTime
    ) external view returns (Checkpoint[] memory) {
        Checkpoint[] memory all = deviceCheckpoints[device];

        uint256 matchCount = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].startTime >= startTime && all[i].endTime <= endTime) matchCount++;
        }

        Checkpoint[] memory result = new Checkpoint[](matchCount);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (all[i].startTime >= startTime && all[i].endTime <= endTime) result[j++] = all[i];
        }
        return result;
    }

    /// @notice The checkpoint `device` anchored with `merkleRoot`. Lookups are always per device.
    function getCheckpointByRoot(address device, bytes32 merkleRoot) public view returns (Checkpoint memory) {
        uint256 index = rootIndex[device][merkleRoot];
        if (index == 0) revert CheckpointNotFound();
        return deviceCheckpoints[device][index - 1];
    }

    /**
     * @notice OpenZeppelin standard-tree leaf: keccak256(keccak256(abi.encode(device, record))).
     * The device is part of every leaf, so a root anchored by another device cannot be used to
     * pass this device's records off as theirs.
     */
    function recordLeafHash(address device, RecordLeaf calldata record) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(device, record))));
    }

    /**
     * @notice True if `record` is one of the records `device` committed to (leaves bind the device) in the checkpoint
     * anchored with `merkleRoot`, and its timestamp lies inside that checkpoint's window
     * (with one second of tolerance for the window's rounding to whole seconds).
     */
    function verifyRecord(
        address device,
        bytes32 merkleRoot,
        bytes32[] calldata proof,
        RecordLeaf calldata record
    ) external view returns (bool) {
        Checkpoint memory c = getCheckpointByRoot(device, merkleRoot);
        uint256 startMs = (uint256(c.startTime) - 1) * 1000;
        uint256 endMs = (uint256(c.endTime) + 1) * 1000;
        if (record.timestampMs < startMs || record.timestampMs > endMs) return false;
        return MerkleProof.verifyCalldata(proof, merkleRoot, recordLeafHash(device, record));
    }

    function requestProofForLegal(address device, bytes32 merkleRoot) external {
        getCheckpointByRoot(device, merkleRoot);
        emit ProofRequested(device, merkleRoot, block.timestamp);
    }

    /// @notice The fields XPRewards needs from one checkpoint, without copying the whole history (F17).
    function checkpointSummary(address device, uint256 index)
        external
        view
        returns (uint64 endTime, uint8 avgSpeed, uint16 distanceMeters)
    {
        Checkpoint storage c = deviceCheckpoints[device][index];
        return (c.endTime, c.avgSpeed, c.distanceMeters);
    }

    function getDeviceCheckpointCount(address device) external view returns (uint256) {
        return deviceCheckpoints[device].length;
    }

    function getDeviceStats(address device) external view returns (
        uint256 totalDistance,
        uint256 totalTime,
        uint8 maxRecordedSpeed,
        uint256 checkpointCount
    ) {
        Checkpoint[] memory checkpoints = deviceCheckpoints[device];
        checkpointCount = checkpoints.length;
        for (uint256 i = 0; i < checkpoints.length; i++) {
            totalDistance += checkpoints[i].distanceMeters;
            totalTime += checkpoints[i].endTime - checkpoints[i].startTime;
            if (checkpoints[i].maxSpeed > maxRecordedSpeed) maxRecordedSpeed = checkpoints[i].maxSpeed;
        }
    }
}
