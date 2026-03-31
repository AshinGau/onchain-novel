// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DataTypes} from "../libraries/DataTypes.sol";

/// @title IChapterNFT
/// @notice Interface for chapter copyright proof NFT (ERC-721)
interface IChapterNFT {
    // ============================================================
    //                          EVENTS
    // ============================================================

    event ChapterNFTMinted(
        uint256 indexed tokenId, uint256 indexed novelId, uint256 indexed chapterId, address author, uint32 epoch
    );

    // ============================================================
    //                  CALLED BY NOVELCORE
    // ============================================================

    /// @notice Mint a chapter copyright NFT
    /// @param to Author address
    /// @param novelId Novel ID
    /// @param chapterId Chapter ID
    /// @param epoch Epoch number
    /// @param contentHash Content CID
    /// @return tokenId The minted token ID
    function mint(address to, uint256 novelId, uint256 chapterId, uint32 epoch, bytes32 contentHash)
        external
        returns (uint256 tokenId);

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @notice Get the chapter metadata for a given token
    function getChapterInfo(uint256 tokenId) external view returns (DataTypes.ChapterNFTMetadata memory);

    /// @notice Check if a chapter already has an NFT minted
    function isChapterMinted(uint256 novelId, uint256 chapterId) external view returns (bool);
}
