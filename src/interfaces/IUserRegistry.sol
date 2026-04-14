// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IUserRegistry {
    event NicknameSet(address indexed user, bytes32 nickname);

    error InvalidNickname(uint8 code); // 1 = empty, 2 = already set

    function setNickname(bytes32 nickname) external;

    function nicknames(address user) external view returns (bytes32);
}
