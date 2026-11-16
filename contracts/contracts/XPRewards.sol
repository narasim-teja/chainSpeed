// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./SpeedRegistry.sol";

/**
 * @title XPRewards (v2)
 * @notice Drive-to-earn XP for safe miles, computed from SpeedRegistry v2 checkpoints.
 *
 * XP can only come from checkpoints signed by an Apple-attested device key, so forged
 * checkpoints cannot mint XP (F4). Redemptions burn XP and record a request; there is no
 * gift-card fulfillment, so no codes are issued.
 */
contract XPRewards {
    SpeedRegistry public immutable speedRegistry;

    uint256 public constant XP_PER_SAFE_MILE = 1;
    uint256 public constant DAILY_STREAK_BONUS = 5;
    uint256 public constant METERS_PER_MILE = 1609;
    uint8 public constant SAFE_SPEED_LIMIT = 75; // mph, checkpoint average
    uint256 public constant MAX_XP_PER_DAY = 500;
    /// Checkpoints processed per call, so a long history can never exceed the block gas limit (F17).
    uint256 public constant MAX_BATCH = 100;

    uint256 public constant TARGET_10_COST = 1000;
    uint256 public constant NETFLIX_10_COST = 1000;
    uint256 public constant TARGET_50_COST = 5000;
    uint256 public constant NETFLIX_50_COST = 5000;

    struct UserXP {
        uint256 totalXP;
        uint256 totalMeters;
        uint256 safeMeters;
        uint256 safeMilesCredited; // whole safe miles already turned into XP
        uint256 lastCheckpointProcessed;
        uint256 currentStreak;
        uint256 lastDriveDay; // day number (UTC) of the most recent checkpoint processed
        uint256 xpDay;
        uint256 xpToday;
        bool driveToEarnEnabled;
    }

    /// A redemption request. `code` stays empty: fulfillment would happen off chain and is not built.
    struct GiftCard {
        string provider;
        uint256 value;
        string code;
        bool redeemed;
        uint256 redeemedAt;
    }

    mapping(address => UserXP) public userXP;
    mapping(address => GiftCard[]) public userGiftCards;
    mapping(address => bool) public driveToEarnOptIn;

    event XPEarned(address indexed user, uint256 xpAmount, uint256 miles, string reason);
    event DriveToEarnToggled(address indexed user, bool enabled);
    event RedemptionRequested(address indexed user, string provider, uint256 value, uint256 xpCost);
    event StreakBonus(address indexed user, uint256 streakDays, uint256 bonusXP);

    error DriveToEarnDisabled();
    error InvalidGiftCard();
    error InsufficientXP(uint256 have, uint256 need);

    constructor(address _speedRegistry) {
        speedRegistry = SpeedRegistry(_speedRegistry);
    }

    function toggleDriveToEarn(bool enabled) external {
        driveToEarnOptIn[msg.sender] = enabled;
        userXP[msg.sender].driveToEarnEnabled = enabled;
        emit DriveToEarnToggled(msg.sender, enabled);
    }

    /**
     * @notice Turns the caller's new checkpoints into XP, up to MAX_BATCH per call.
     * Distance accumulates in meters across checkpoints (a 30-second checkpoint is under a
     * mile, so per-checkpoint mile counts always rounded to zero). The cursor always advances,
     * so nothing is counted twice (F18). Streaks follow the day of the drive, not of the call.
     */
    function processCheckpointsForXP() external {
        if (!driveToEarnOptIn[msg.sender]) revert DriveToEarnDisabled();
        UserXP storage user = userXP[msg.sender];

        uint256 count = speedRegistry.getDeviceCheckpointCount(msg.sender);
        uint256 end = user.lastCheckpointProcessed + MAX_BATCH;
        if (end > count) end = count;

        uint256 earned = 0;
        uint256 newSafeMiles = 0;
        for (uint256 i = user.lastCheckpointProcessed; i < end; i++) {
            (uint64 endTime, uint8 avgSpeed, uint16 distanceMeters) = speedRegistry.checkpointSummary(msg.sender, i);
            uint256 day = uint256(endTime) / 1 days;

            if (day != user.xpDay) {
                user.xpDay = day;
                user.xpToday = 0;
            }
            if (day != user.lastDriveDay) {
                if (user.lastDriveDay != 0 && day == user.lastDriveDay + 1) {
                    user.currentStreak++;
                    earned += _credit(user, DAILY_STREAK_BONUS);
                    emit StreakBonus(msg.sender, user.currentStreak, DAILY_STREAK_BONUS);
                } else {
                    user.currentStreak = 1;
                }
                user.lastDriveDay = day;
            }

            user.totalMeters += distanceMeters;
            if (avgSpeed <= SAFE_SPEED_LIMIT) {
                user.safeMeters += distanceMeters;
                uint256 miles = user.safeMeters / METERS_PER_MILE - user.safeMilesCredited;
                if (miles > 0) {
                    user.safeMilesCredited += miles;
                    newSafeMiles += miles;
                    earned += _credit(user, miles * XP_PER_SAFE_MILE);
                }
            }
        }
        user.lastCheckpointProcessed = end;

        if (earned > 0) emit XPEarned(msg.sender, earned, newSafeMiles, "Safe driving miles");
    }

    /// Adds XP within the daily cap; returns what was actually credited.
    function _credit(UserXP storage user, uint256 xp) private returns (uint256) {
        uint256 room = MAX_XP_PER_DAY - user.xpToday;
        if (xp > room) xp = room;
        user.xpToday += xp;
        user.totalXP += xp;
        return xp;
    }

    /// @notice Burns XP for a gift card request. No code is issued: fulfillment is not built.
    function redeemGiftCard(string calldata provider, uint256 value) external {
        if (!driveToEarnOptIn[msg.sender]) revert DriveToEarnDisabled();
        uint256 cost = getGiftCardCost(provider, value);
        if (cost == 0) revert InvalidGiftCard();
        UserXP storage user = userXP[msg.sender];
        if (user.totalXP < cost) revert InsufficientXP(user.totalXP, cost);

        user.totalXP -= cost;
        userGiftCards[msg.sender].push(
            GiftCard({provider: provider, value: value, code: "", redeemed: false, redeemedAt: block.timestamp})
        );
        emit RedemptionRequested(msg.sender, provider, value, cost);
    }

    function getGiftCardCost(string memory provider, uint256 value) public pure returns (uint256) {
        bytes32 p = keccak256(bytes(provider));
        if (p == keccak256("TARGET")) {
            if (value == 10) return TARGET_10_COST;
            if (value == 50) return TARGET_50_COST;
        } else if (p == keccak256("NETFLIX")) {
            if (value == 10) return NETFLIX_10_COST;
            if (value == 50) return NETFLIX_50_COST;
        }
        return 0;
    }

    /// @notice Same shape as v1 for the app: (totalXP, lifetimeMiles, safeMiles, currentStreak, enabled).
    function getUserXP(address user)
        external
        view
        returns (uint256 totalXP, uint256 lifetimeMiles, uint256 safeMiles, uint256 currentStreak, bool driveToEarnEnabled)
    {
        UserXP storage u = userXP[user];
        return (u.totalXP, u.totalMeters / METERS_PER_MILE, u.safeMeters / METERS_PER_MILE, u.currentStreak, u.driveToEarnEnabled);
    }

    function getUserGiftCards(address user) external view returns (GiftCard[] memory) {
        return userGiftCards[user];
    }

    function getGiftCardOptions()
        external
        pure
        returns (string[] memory providers, uint256[] memory values, uint256[] memory costs)
    {
        providers = new string[](4);
        values = new uint256[](4);
        costs = new uint256[](4);
        (providers[0], values[0], costs[0]) = ("TARGET", 10, TARGET_10_COST);
        (providers[1], values[1], costs[1]) = ("NETFLIX", 10, NETFLIX_10_COST);
        (providers[2], values[2], costs[2]) = ("TARGET", 50, TARGET_50_COST);
        (providers[3], values[3], costs[3]) = ("NETFLIX", 50, NETFLIX_50_COST);
    }
}
