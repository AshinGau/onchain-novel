// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";
import {BountyBoard} from "../src/core/BountyBoard.sol";
import {RoundManager} from "../src/core/RoundManager.sol";
import {UserRegistry} from "../src/core/UserRegistry.sol";

/// @title DeployProduction
/// @notice Production deployment with TimelockController for owner operations
/// @dev Deploys all contracts + Timelock, transfers ownership to Timelock
///      Requires environment variables:
///        PRIVATE_KEY — deployer private key
///        MULTISIG    — multi-sig address (Gnosis Safe) that controls the Timelock
///        TIMELOCK_DELAY — minimum delay for Timelock operations (seconds, e.g. 86400 for 1 day)
///      Optional:
///        DEPLOY_SALT — bytes32 salt for CREATE2 (default keccak256("onchain-novel.v1"))
contract DeployProduction is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address multisig = vm.envAddress("MULTISIG");
        uint256 timelockDelay = vm.envOr("TIMELOCK_DELAY", uint256(86400));
        bytes32 salt = vm.envOr("DEPLOY_SALT", keccak256("onchain-novel.v1"));

        console.log("Deployer:", deployer);
        console.log("Multi-sig:", multisig);
        console.log("Timelock delay:", timelockDelay, "seconds");
        console.logBytes32(salt);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy TimelockController
        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = multisig;
        TimelockController timelock =
            new TimelockController{salt: salt}(timelockDelay, proposers, executors, address(0));
        console.log("TimelockController:", address(timelock));

        // 2. Deploy implementations
        NovelCore novelCoreImpl = new NovelCore{salt: salt}();
        VotingEngine votingEngineImpl = new VotingEngine{salt: salt}();
        PrizePool prizePoolImpl = new PrizePool{salt: salt}();
        RulesEngine rulesEngineImpl = new RulesEngine{salt: salt}();
        BountyBoard bountyBoardImpl = new BountyBoard{salt: salt}();
        RoundManager roundManagerImpl = new RoundManager{salt: salt}();

        // 3. Standalone UserRegistry — deploy before NovelCore so its address
        //    can be embedded into NovelCore's address book at initialize time.
        UserRegistry userRegistry = new UserRegistry{salt: salt}();

        // 4. Deploy proxies — initially owned by deployer (will transfer to Timelock)
        ERC1967Proxy votingProxy = new ERC1967Proxy{salt: salt}(
            address(votingEngineImpl), abi.encodeCall(VotingEngine.initialize, (deployer, address(1)))
        );
        ERC1967Proxy prizeProxy = new ERC1967Proxy{salt: salt}(
            address(prizePoolImpl), abi.encodeCall(PrizePool.initialize, (deployer, address(1)))
        );
        ERC1967Proxy rulesProxy = new ERC1967Proxy{salt: salt}(
            address(rulesEngineImpl),
            abi.encodeCall(RulesEngine.initialize, (deployer, address(1), address(prizeProxy)))
        );
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy{salt: salt}(
            address(novelCoreImpl),
            abi.encodeCall(
                NovelCore.initialize,
                (deployer, address(votingProxy), address(prizeProxy), address(rulesProxy), address(userRegistry))
            )
        );
        ERC1967Proxy bountyProxy = new ERC1967Proxy{salt: salt}(
            address(bountyBoardImpl),
            abi.encodeCall(BountyBoard.initialize, (deployer, address(novelCoreProxy), address(prizeProxy)))
        );
        ERC1967Proxy roundProxy = new ERC1967Proxy{salt: salt}(
            address(roundManagerImpl),
            abi.encodeCall(
                RoundManager.initialize, (deployer, address(novelCoreProxy), address(votingProxy), address(prizeProxy))
            )
        );

        // 5. Wire addresses
        VotingEngine(payable(address(votingProxy))).setRoundManager(address(roundProxy));
        VotingEngine(payable(address(votingProxy))).setPrizePool(address(prizeProxy));
        PrizePool(payable(address(prizeProxy))).setNovelCore(address(novelCoreProxy));
        PrizePool(payable(address(prizeProxy))).setRoundManager(address(roundProxy));
        PrizePool(payable(address(prizeProxy))).setRulesEngine(address(rulesProxy));
        PrizePool(payable(address(prizeProxy))).setBountyBoard(address(bountyProxy));
        PrizePool(payable(address(prizeProxy))).setVotingEngine(address(votingProxy));
        RulesEngine(address(rulesProxy)).setNovelCore(address(novelCoreProxy));
        NovelCore(payable(address(novelCoreProxy))).setRoundManager(address(roundProxy));

        // 6. Transfer ownership of all upgradeable contracts to TimelockController
        NovelCore(payable(address(novelCoreProxy))).transferOwnership(address(timelock));
        RoundManager(payable(address(roundProxy))).transferOwnership(address(timelock));
        VotingEngine(payable(address(votingProxy))).transferOwnership(address(timelock));
        PrizePool(payable(address(prizeProxy))).transferOwnership(address(timelock));
        RulesEngine(address(rulesProxy)).transferOwnership(address(timelock));
        BountyBoard(payable(address(bountyProxy))).transferOwnership(address(timelock));

        vm.stopBroadcast();

        console.log("=== Proxy Addresses ===");
        console.log("NovelCore:", address(novelCoreProxy));
        console.log("RoundManager:", address(roundProxy));
        console.log("VotingEngine:", address(votingProxy));
        console.log("PrizePool:", address(prizeProxy));
        console.log("RulesEngine:", address(rulesProxy));
        console.log("BountyBoard:", address(bountyProxy));
        console.log("UserRegistry:", address(userRegistry));
        console.log("=== Governance ===");
        console.log("TimelockController:", address(timelock));
        console.log("Multi-sig (proposer/executor):", multisig);
    }
}
