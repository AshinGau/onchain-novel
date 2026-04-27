// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {NovelCore} from "../src/core/NovelCore.sol";
import {VotingEngine} from "../src/core/VotingEngine.sol";
import {PrizePool} from "../src/core/PrizePool.sol";
import {RulesEngine} from "../src/core/RulesEngine.sol";
import {BountyBoard} from "../src/core/BountyBoard.sol";
import {RoundManager} from "../src/core/RoundManager.sol";
import {UserRegistry} from "../src/core/UserRegistry.sol";

/// @title Deploy
/// @notice Deploys all protocol contracts behind UUPS proxies and wires them together
/// @dev Decentralized Collaborative Novel Protocol
///      Deploy order matters: implementations first, then proxies (with placeholder
///      addresses where a circular reference exists), then wiring.
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
        RoundManager roundManagerImpl = new RoundManager();

        console.log("NovelCore impl:", address(novelCoreImpl));
        console.log("VotingEngine impl:", address(votingEngineImpl));
        console.log("PrizePool impl:", address(prizePoolImpl));
        console.log("RulesEngine impl:", address(rulesEngineImpl));
        console.log("BountyBoard impl:", address(bountyBoardImpl));
        console.log("RoundManager impl:", address(roundManagerImpl));

        // 2. Standalone UserRegistry — must precede NovelCore so the address
        //    can be embedded into NovelCore's address book at initialize time.
        UserRegistry userRegistry = new UserRegistry();

        // 3. Deploy proxies (with placeholder addresses for circular refs; wired in step 4)
        bytes memory votingData = abi.encodeCall(VotingEngine.initialize, (deployer, address(0)));
        ERC1967Proxy votingProxy = new ERC1967Proxy(address(votingEngineImpl), votingData);

        bytes memory prizeData = abi.encodeCall(PrizePool.initialize, (deployer, address(0)));
        ERC1967Proxy prizeProxy = new ERC1967Proxy(address(prizePoolImpl), prizeData);

        bytes memory rulesData = abi.encodeCall(RulesEngine.initialize, (deployer, address(0), address(prizeProxy)));
        ERC1967Proxy rulesProxy = new ERC1967Proxy(address(rulesEngineImpl), rulesData);

        bytes memory novelCoreData = abi.encodeCall(
            NovelCore.initialize,
            (deployer, address(votingProxy), address(prizeProxy), address(rulesProxy), address(userRegistry))
        );
        ERC1967Proxy novelCoreProxy = new ERC1967Proxy(address(novelCoreImpl), novelCoreData);

        bytes memory bountyData =
            abi.encodeCall(BountyBoard.initialize, (deployer, address(novelCoreProxy), address(prizeProxy)));
        ERC1967Proxy bountyProxy = new ERC1967Proxy(address(bountyBoardImpl), bountyData);

        bytes memory roundData = abi.encodeCall(
            RoundManager.initialize, (deployer, address(novelCoreProxy), address(votingProxy), address(prizeProxy))
        );
        ERC1967Proxy roundProxy = new ERC1967Proxy(address(roundManagerImpl), roundData);

        // 4. Wire addresses
        VotingEngine(payable(address(votingProxy))).setRoundManager(address(roundProxy));
        VotingEngine(payable(address(votingProxy))).setPrizePool(address(prizeProxy));
        PrizePool(payable(address(prizeProxy))).setNovelCore(address(novelCoreProxy));
        PrizePool(payable(address(prizeProxy))).setRoundManager(address(roundProxy));
        PrizePool(payable(address(prizeProxy))).setRulesEngine(address(rulesProxy));
        PrizePool(payable(address(prizeProxy))).setBountyBoard(address(bountyProxy));
        PrizePool(payable(address(prizeProxy))).setVotingEngine(address(votingProxy));
        RulesEngine(address(rulesProxy)).setNovelCore(address(novelCoreProxy));
        NovelCore(payable(address(novelCoreProxy))).setRoundManager(address(roundProxy));
        // Initial keeper = deployer; owner should rotate via setKeeper post-deploy.
        RoundManager(payable(address(roundProxy))).setKeeper(deployer);

        vm.stopBroadcast();

        console.log("=== Proxy Addresses (use these) ===");
        console.log("NovelCore:", address(novelCoreProxy));
        console.log("RoundManager:", address(roundProxy));
        console.log("VotingEngine:", address(votingProxy));
        console.log("PrizePool:", address(prizeProxy));
        console.log("RulesEngine:", address(rulesProxy));
        console.log("BountyBoard:", address(bountyProxy));
        console.log("UserRegistry:", address(userRegistry));
    }
}
