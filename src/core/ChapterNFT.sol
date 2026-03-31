// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {IChapterNFT} from "../interfaces/IChapterNFT.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title ChapterNFT
/// @notice ERC-721 NFT for chapter copyright proof. One global contract for all novels.
/// @dev Only the authorized NovelCore contract can mint NFTs.
contract ChapterNFT is Initializable, ERC721Upgradeable, OwnableUpgradeable, UUPSUpgradeable, IChapterNFT {
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Next token ID to mint
    uint256 private _nextTokenId;

    /// @notice Authorized NovelCore contract address
    address public novelCore;

    /// @notice Token ID => chapter metadata
    mapping(uint256 tokenId => DataTypes.ChapterNFTMetadata) private _chapterMetadata;

    /// @notice Track minted chapters: novelId => chapterId => bool
    mapping(uint256 novelId => mapping(uint256 chapterId => bool)) private _mintedChapters;

    // ============================================================
    //                         ERRORS
    // ============================================================

    error OnlyNovelCore();
    error ChapterAlreadyMinted(uint256 novelId, uint256 chapterId);
    error TokenDoesNotExist(uint256 tokenId);

    // ============================================================
    //                        MODIFIERS
    // ============================================================

    modifier onlyNovelCore() {
        if (msg.sender != novelCore) revert OnlyNovelCore();
        _;
    }

    // ============================================================
    //                      INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the NFT contract
    /// @param owner_ Initial owner address
    /// @param novelCore_ Authorized NovelCore contract address
    function initialize(address owner_, address novelCore_) external initializer {
        __ERC721_init("Chapter Copyright NFT", "CHAPTER");
        __Ownable_init(owner_);

        novelCore = novelCore_;
        _nextTokenId = 1; // Start from 1
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    /// @notice Update the authorized NovelCore address (for upgrades)
    /// @param newNovelCore New NovelCore contract address
    function setNovelCore(address newNovelCore) external onlyOwner {
        novelCore = newNovelCore;
    }

    // ============================================================
    //                     MINT (NovelCore only)
    // ============================================================

    /// @inheritdoc IChapterNFT
    function mint(address to, uint256 novelId, uint256 chapterId, uint32 epoch, bytes32 contentHash)
        external
        onlyNovelCore
        returns (uint256 tokenId)
    {
        if (_mintedChapters[novelId][chapterId]) {
            revert ChapterAlreadyMinted(novelId, chapterId);
        }

        tokenId = _nextTokenId++;

        _safeMint(to, tokenId);

        _chapterMetadata[tokenId] = DataTypes.ChapterNFTMetadata({
            novelId: novelId,
            chapterId: chapterId,
            epoch: epoch,
            author: to,
            contentHash: contentHash
        });

        _mintedChapters[novelId][chapterId] = true;

        emit ChapterNFTMinted(tokenId, novelId, chapterId, to, epoch);
    }

    // ============================================================
    //                        QUERIES
    // ============================================================

    /// @inheritdoc IChapterNFT
    function getChapterInfo(uint256 tokenId) external view returns (DataTypes.ChapterNFTMetadata memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist(tokenId);
        return _chapterMetadata[tokenId];
    }

    /// @inheritdoc IChapterNFT
    function isChapterMinted(uint256 novelId, uint256 chapterId) external view returns (bool) {
        return _mintedChapters[novelId][chapterId];
    }

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    /// @dev Only the owner can authorize upgrades
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
