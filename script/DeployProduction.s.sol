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

/// @title DeployProduction
/// @notice Production deployment with TimelockController for owner operations
/// @dev Deploys all contracts + Timelock, transfers ownership to Timelock
///      Requires environment variables:
///        PRIVATE_KEY — deployer private key
///        MULTISIG    — multi-sig address (Gnosis Safe) that controls the Timelock
///        TIMELOCK_DELAY — minimum delay for Timelock operations (seconds, e.g. 86400 for 1 day)
contract DeployProduction is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address multisig = vm.envAddress("MULTISIG");
        uint256 timelockDelay = vm.envOr("TIMELOCK_DELAY", uint256(86400));

        console.log("Deployer:", deployer);
        console.log("Multi-sig:", multisig);
        console.log("Timelock delay:", timelockDelay, "seconds");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy TimelockController
        address[] memory proposers = new address[](1);
        proposers[0] = multisig;
        address[] memory executors = new address[](1);
        executors[0] = multisig;

        TimelockController timelock = new TimelockController(timelockDelay, proposers, executors, address(0));
        console.log("TimelockController:", address(timelock));

        // 2. Deploy implementations
        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        RulesEngine rulesEngineImpl = new RulesEngine();
        BountyBoard bountyBoardImpl = new BountyBoard();

        // 3. Deploy proxies — initially owned by deployer (will transfer to Timelock)
        ERC1967Proxy votingProxy =
            new ERC1967Proxy(address(votingEngineImpl), abi.encodeCall(VotingEngine.initialize, (deployer, address(1))));

        ERC1967Proxy prizeProxy =
            new ERC1967Proxy(address(prizePoolImpl), abi.encodeCall(PrizePool.initialize, (deployer, address(1))));

        ERC1967Proxy rulesProxy = new ERC1967Proxy(
            address(rulesEngineImpl),
            abi.encodeCall(RulesEngine.initialize, (deployer, address(1), address(prizeProxy)))
        );

        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(
            address(novelCoreImpl),
            abi.encodeCall(
                NovelCore.initialize, (deployer, address(votingProxy), address(prizeProxy), address(rulesProxy))
            )
        );

        ERC1967Proxy bountyProxy = new ERC1967Proxy(
            address(bountyBoardImpl),
            abi.encodeCall(BountyBoard.initialize, (deployer, address(novelCoreProxy), address(prizeProxy)))
        );

        // 4. Wire NovelCore address to modules
        VotingEngine(payable(address(votingProxy))).setNovelCore(address(novelCoreProxy));
        PrizePool(payable(address(prizeProxy))).setNovelCore(address(novelCoreProxy));
        RulesEngine(address(rulesProxy)).setNovelCore(address(novelCoreProxy));
        PrizePool(payable(address(prizeProxy))).setRulesEngine(address(rulesProxy));
        PrizePool(payable(address(prizeProxy))).setBountyBoard(address(bountyProxy));

        // 5. Transfer ownership of all contracts to TimelockController
        NovelCore(payable(address(novelCoreProxy))).transferOwnership(address(timelock));
        VotingEngine(payable(address(votingProxy))).transferOwnership(address(timelock));
        PrizePool(payable(address(prizeProxy))).transferOwnership(address(timelock));
        RulesEngine(address(rulesProxy)).transferOwnership(address(timelock));
        BountyBoard(payable(address(bountyProxy))).transferOwnership(address(timelock));

        vm.stopBroadcast();

        // 6. Log deployed addresses
        console.log("=== Proxy Addresses ===");
        console.log("NovelCore:", address(novelCoreProxy));
        console.log("VotingEngine:", address(votingProxy));
        console.log("PrizePool:", address(prizeProxy));
        console.log("RulesEngine:", address(rulesProxy));
        console.log("BountyBoard:", address(bountyProxy));
        console.log("=== Governance ===");
        console.log("TimelockController:", address(timelock));
        console.log("Multi-sig (proposer/executor):", multisig);
    }
}
