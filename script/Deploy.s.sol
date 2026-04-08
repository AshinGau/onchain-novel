// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";
import {BountyBoard} from "../src/core/BountyBoard.sol";

/// @title Deploy
/// @notice Deploys all V2 protocol contracts behind UUPS proxies and wires them together
/// @dev Decentralized Collaborative Novel Protocol V2
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy implementations
        NovelCore novelCoreImpl = new NovelCore();
        VotingEngine votingEngineImpl = new VotingEngine();
        PrizePool prizePoolImpl = new PrizePool();
        RulesEngine rulesEngineImpl = new RulesEngine();
        BountyBoard bountyBoardImpl = new BountyBoard();

        console.log("NovelCore impl:", address(novelCoreImpl));
        console.log("VotingEngine impl:", address(votingEngineImpl));
        console.log("PrizePool impl:", address(prizePoolImpl));
        console.log("RulesEngine impl:", address(rulesEngineImpl));
        console.log("BountyBoard impl:", address(bountyBoardImpl));

        // 2. Deploy VotingEngine proxy (with placeholder NovelCore address)
        bytes memory votingData = abi.encodeCall(VotingEngine.initialize, (deployer, address(0)));
        ERC1967Proxy votingProxy = new ERC1967Proxy(address(votingEngineImpl), votingData);

        // 3. Deploy PrizePool proxy (with placeholder NovelCore address)
        bytes memory prizeData = abi.encodeCall(PrizePool.initialize, (deployer, address(0)));
        ERC1967Proxy prizeProxy = new ERC1967Proxy(address(prizePoolImpl), prizeData);

        // 4. Deploy RulesEngine proxy (with placeholder addresses)
        bytes memory rulesData = abi.encodeCall(RulesEngine.initialize, (deployer, address(0), address(prizeProxy)));
        ERC1967Proxy rulesProxy = new ERC1967Proxy(address(rulesEngineImpl), rulesData);

        // 5. Deploy NovelCore proxy (with real module addresses)
        bytes memory novelCoreData = abi.encodeCall(
            NovelCore.initialize, (deployer, address(votingProxy), address(prizeProxy), address(rulesProxy))
        );
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(address(novelCoreImpl), novelCoreData);

        // 6. Deploy BountyBoard proxy
        bytes memory bountyData =
            abi.encodeCall(BountyBoard.initialize, (deployer, address(novelCoreProxy), address(prizeProxy)));
        ERC1967Proxy bountyProxy = new ERC1967Proxy(address(bountyBoardImpl), bountyData);

        // 7. Wire NovelCore address to modules
        VotingEngine(payable(address(votingProxy))).setNovelCore(address(novelCoreProxy));
        PrizePool(payable(address(prizeProxy))).setNovelCore(address(novelCoreProxy));
        RulesEngine(address(rulesProxy)).setNovelCore(address(novelCoreProxy));

        // 8. Set RulesEngine and BountyBoard on PrizePool (so they can deposit fees)
        PrizePool(payable(address(prizeProxy))).setRulesEngine(address(rulesProxy));
        PrizePool(payable(address(prizeProxy))).setBountyBoard(address(bountyProxy));

        vm.stopBroadcast();

        // 9. Log deployed addresses
        console.log("=== Proxy Addresses (use these) ===");
        console.log("NovelCore:", address(novelCoreProxy));
        console.log("VotingEngine:", address(votingProxy));
        console.log("PrizePool:", address(prizeProxy));
        console.log("RulesEngine:", address(rulesProxy));
        console.log("BountyBoard:", address(bountyProxy));
    }
}
