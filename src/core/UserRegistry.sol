// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUserRegistry} from "../interfaces/IUserRegistry.sol";

/// @title UserRegistry
/// @notice One-time, immutable nickname registry. Independent of novels/chapters.
/// @dev Non-upgradeable: trivial state, no need for UUPS overhead.
contract UserRegistry is IUserRegistry {
    mapping(address => bytes32) public nicknames;

    function setNickname(bytes32 nickname) external {
        if (nickname == bytes32(0)) revert InvalidNickname(1);
        if (nicknames[msg.sender] != bytes32(0)) revert InvalidNickname(2);
        nicknames[msg.sender] = nickname;
        emit NicknameSet(msg.sender, nickname);
    }
}
