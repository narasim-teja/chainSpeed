// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./SpeedRegistry.sol";

/**
 * @title XPRewards
 * @dev Drive-to-earn XP system that rewards safe driving behavior
 * Reads from SpeedRegistry to calculate XP based on safe driving miles
 */
contract XPRewards {
    
    SpeedRegistry public immutable speedRegistry;
    
    // XP rates
    uint256 public constant XP_PER_SAFE_MILE = 1;
    uint256 public constant DAILY_STREAK_BONUS = 5;
    uint256 public constant METERS_PER_MILE = 1609; // 1 mile = 1609 meters
    
    // Gift card costs (in XP)
    uint256 public constant TARGET_10_COST = 1000;
    uint256 public constant NETFLIX_10_COST = 1000;
    uint256 public constant TARGET_50_COST = 5000;
    uint256 public constant NETFLIX_50_COST = 5000;
    
    // Speed limit for "safe driving" (mph)
    uint8 public constant SAFE_SPEED_LIMIT = 75;
    
    struct UserXP {
        uint256 totalXP;
        uint256 lifetimeMiles;
        uint256 safeMiles;
        uint256 lastCheckpointProcessed;
        uint256 currentStreak;
        uint256 lastDriveDate; // Date of last drive (for streak calculation)
        bool driveToEarnEnabled;
    }
    
    struct GiftCard {
        string provider; // "TARGET", "NETFLIX"
        uint256 value;   // $10, $50
        string code;     // Redemption code
        bool redeemed;
        uint256 redeemedAt;
    }
    
    // User data
    mapping(address => UserXP) public userXP;
    mapping(address => GiftCard[]) public userGiftCards;
    mapping(address => bool) public driveToEarnOptIn;
    
    // City-level aggregated stats (for data monetization)
    mapping(string => uint256) public citySafeMiles;
    mapping(string => uint256) public cityTotalMiles;
    
    // Events
    event XPEarned(address indexed user, uint256 xpAmount, uint256 miles, string reason);
    event DriveToEarnToggled(address indexed user, bool enabled);
    event GiftCardRedeemed(address indexed user, string provider, uint256 value, uint256 xpCost);
    event StreakBonus(address indexed user, uint256 streakDays, uint256 bonusXP);
    
    constructor(address _speedRegistry) {
        speedRegistry = SpeedRegistry(_speedRegistry);
    }
    
    /**
     * @dev Enable/disable drive-to-earn for a user
     */
    function toggleDriveToEarn(bool enabled) external {
        driveToEarnOptIn[msg.sender] = enabled;
        userXP[msg.sender].driveToEarnEnabled = enabled;
        emit DriveToEarnToggled(msg.sender, enabled);
    }
    
    /**
     * @dev Process new checkpoints and award XP for safe driving
     * Called by the mobile app after submitting checkpoints
     */
    function processCheckpointsForXP() external {
        require(driveToEarnOptIn[msg.sender], "Drive-to-earn not enabled");
        
        UserXP storage user = userXP[msg.sender];
        SpeedRegistry.Checkpoint[] memory checkpoints = speedRegistry.getDeviceCheckpoints(msg.sender);
        
        uint256 newXP = 0;
        uint256 newSafeMiles = 0;
        uint256 newTotalMiles = 0;
        
        // Process only new checkpoints
        for (uint256 i = user.lastCheckpointProcessed; i < checkpoints.length; i++) {
            SpeedRegistry.Checkpoint memory checkpoint = checkpoints[i];
            
            // Calculate miles from meters
            uint256 miles = checkpoint.distanceMeters / METERS_PER_MILE;
            newTotalMiles += miles;
            
            // Award XP only if average speed was within safe limits
            if (checkpoint.avgSpeed <= SAFE_SPEED_LIMIT) {
                newSafeMiles += miles;
                newXP += miles * XP_PER_SAFE_MILE;
            }
        }
        
        if (newXP > 0) {
            user.totalXP += newXP;
            user.safeMiles += newSafeMiles;
            user.lifetimeMiles += newTotalMiles;
            user.lastCheckpointProcessed = checkpoints.length;
            
            // Check for daily streak bonus
            uint256 today = block.timestamp / 86400; // Days since epoch
            uint256 lastDriveDay = user.lastDriveDate / 86400;
            
            if (lastDriveDay > 0 && today == lastDriveDay + 1) {
                // Consecutive day driving
                user.currentStreak++;
                uint256 streakBonus = DAILY_STREAK_BONUS;
                user.totalXP += streakBonus;
                newXP += streakBonus;
                
                emit StreakBonus(msg.sender, user.currentStreak, streakBonus);
            } else if (today > lastDriveDay + 1) {
                // Streak broken
                user.currentStreak = 1;
            }
            
            user.lastDriveDate = block.timestamp;
            
            emit XPEarned(msg.sender, newXP, newSafeMiles, "Safe driving miles");
        }
    }
    
    /**
     * @dev Redeem XP for gift cards
     */
    function redeemGiftCard(string memory provider, uint256 value) external {
        require(driveToEarnOptIn[msg.sender], "Drive-to-earn not enabled");
        
        uint256 cost = getGiftCardCost(provider, value);
        require(cost > 0, "Invalid gift card");
        require(userXP[msg.sender].totalXP >= cost, "Insufficient XP");
        
        // Deduct XP
        userXP[msg.sender].totalXP -= cost;
        
        // Generate mock gift card code (in production, integrate with gift card API)
        string memory code = generateGiftCardCode(provider, value);
        
        // Store gift card
        userGiftCards[msg.sender].push(GiftCard({
            provider: provider,
            value: value,
            code: code,
            redeemed: true,
            redeemedAt: block.timestamp
        }));
        
        emit GiftCardRedeemed(msg.sender, provider, value, cost);
    }
    
    /**
     * @dev Get gift card cost in XP
     */
    function getGiftCardCost(string memory provider, uint256 value) public pure returns (uint256) {
        bytes32 providerHash = keccak256(abi.encodePacked(provider));
        
        if (providerHash == keccak256(abi.encodePacked("TARGET"))) {
            if (value == 10) return TARGET_10_COST;
            if (value == 50) return TARGET_50_COST;
        } else if (providerHash == keccak256(abi.encodePacked("NETFLIX"))) {
            if (value == 10) return NETFLIX_10_COST;
            if (value == 50) return NETFLIX_50_COST;
        }
        
        return 0; // Invalid combination
    }
    
    /**
     * @dev Generate mock gift card code
     */
    function generateGiftCardCode(string memory provider, uint256 value) internal view returns (string memory) {
        bytes32 hash = keccak256(abi.encodePacked(
            msg.sender,
            provider,
            value,
            block.timestamp,
            block.difficulty
        ));
        
        // Convert to readable format (first 12 chars of hash)
        return string(abi.encodePacked(
            provider,
            "-",
            toHexString(uint256(hash) >> 208) // Take first 48 bits (12 hex chars)
        ));
    }
    
    /**
     * @dev Convert uint to hex string
     */
    function toHexString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        
        uint256 temp = value;
        uint256 length = 0;
        while (temp != 0) {
            length++;
            temp >>= 4;
        }
        
        bytes memory buffer = new bytes(length);
        while (value != 0) {
            length -= 1;
            buffer[length] = bytes1(uint8(48 + uint256(value & 0xf)));
            if (uint256(value & 0xf) > 9) {
                buffer[length] = bytes1(uint8(87 + uint256(value & 0xf)));
            }
            value >>= 4;
        }
        
        return string(buffer);
    }
    
    /**
     * @dev Get user's XP and stats
     */
    function getUserXP(address user) external view returns (
        uint256 totalXP,
        uint256 lifetimeMiles,
        uint256 safeMiles,
        uint256 currentStreak,
        bool driveToEarnEnabled
    ) {
        UserXP memory userStats = userXP[user];
        return (
            userStats.totalXP,
            userStats.lifetimeMiles,
            userStats.safeMiles,
            userStats.currentStreak,
            userStats.driveToEarnEnabled
        );
    }
    
    /**
     * @dev Get user's gift cards
     */
    function getUserGiftCards(address user) external view returns (GiftCard[] memory) {
        return userGiftCards[user];
    }
    
    /**
     * @dev Update city stats for data monetization (called by aggregation service)
     */
    function updateCityStats(string memory city, uint256 safeMiles, uint256 totalMiles) external {
        // In production, add access control for authorized aggregation service
        citySafeMiles[city] += safeMiles;
        cityTotalMiles[city] += totalMiles;
    }
    
    /**
     * @dev Get city safety statistics (for data buyers)
     */
    function getCityStats(string memory city) external view returns (
        uint256 safeMiles,
        uint256 totalMiles,
        uint256 safetyPercentage
    ) {
        safeMiles = citySafeMiles[city];
        totalMiles = cityTotalMiles[city];
        safetyPercentage = totalMiles > 0 ? (safeMiles * 100) / totalMiles : 0;
    }
    
    /**
     * @dev Get available gift card options
     */
    function getGiftCardOptions() external pure returns (
        string[] memory providers,
        uint256[] memory values,
        uint256[] memory costs
    ) {
        providers = new string[](4);
        values = new uint256[](4);
        costs = new uint256[](4);
        
        providers[0] = "TARGET";
        values[0] = 10;
        costs[0] = TARGET_10_COST;
        
        providers[1] = "TARGET";
        values[1] = 50;
        costs[1] = TARGET_50_COST;
        
        providers[2] = "NETFLIX";
        values[2] = 10;
        costs[2] = NETFLIX_10_COST;
        
        providers[3] = "NETFLIX";
        values[3] = 50;
        costs[3] = NETFLIX_50_COST;
    }
}