// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {ChapterNFT} from "../src/core/ChapterNFT.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";

/// @title Deploy
/// @notice Deploys all protocol contracts behind UUPS proxies and wires them together
/// @dev Decentralized Collaborative Novel Protocol — multi-Agent co-authoring on-chain
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
        ChapterNFT chapterNFTImpl = new ChapterNFT();
        RulesEngine rulesEngineImpl = new RulesEngine();

        console.log("NovelCore impl:", address(novelCoreImpl));
        console.log("VotingEngine impl:", address(votingEngineImpl));
        console.log("PrizePool impl:", address(prizePoolImpl));
        console.log("ChapterNFT impl:", address(chapterNFTImpl));
        console.log("RulesEngine impl:", address(rulesEngineImpl));

        // 2. Deploy NovelCore proxy (with placeholder module addresses)
        bytes memory novelCoreData =
            abi.encodeCall(NovelCore.initialize, (deployer, address(0), address(0), address(0)));
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(address(novelCoreImpl), novelCoreData);
        NovelCore novelCore = NovelCore(payable(address(novelCoreProxy)));

        // 3. Deploy module proxies (pointing to NovelCore)
        bytes memory votingData = abi.encodeCall(VotingEngine.initialize, (deployer, address(novelCoreProxy)));
        ERC1967Proxy votingProxy = new ERC1967Proxy(address(votingEngineImpl), votingData);

        bytes memory prizeData = abi.encodeCall(PrizePool.initialize, (deployer, address(novelCoreProxy)));
        ERC1967Proxy prizeProxy = new ERC1967Proxy(address(prizePoolImpl), prizeData);

        bytes memory nftData = abi.encodeCall(ChapterNFT.initialize, (deployer, address(novelCoreProxy)));
        ERC1967Proxy nftProxy = new ERC1967Proxy(address(chapterNFTImpl), nftData);

        // 4. Deploy RulesEngine proxy
        bytes memory rulesData =
            abi.encodeCall(RulesEngine.initialize, (deployer, address(novelCoreProxy), address(prizeProxy)));
        ERC1967Proxy rulesProxy = new ERC1967Proxy(address(rulesEngineImpl), rulesData);

        // 5. Wire NovelCore to modules
        novelCore.setVotingEngine(address(votingProxy));
        novelCore.setPrizePool(address(prizeProxy));
        novelCore.setChapterNFT(address(nftProxy));
        PrizePool(address(prizeProxy)).setRulesEngine(address(rulesProxy));

        vm.stopBroadcast();

        // 6. Log deployed addresses
        console.log("=== Proxy Addresses (use these) ===");
        console.log("NovelCore:", address(novelCoreProxy));
        console.log("VotingEngine:", address(votingProxy));
        console.log("PrizePool:", address(prizeProxy));
        console.log("ChapterNFT:", address(nftProxy));
        console.log("RulesEngine:", address(rulesProxy));
    }
}
