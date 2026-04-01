// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IChapterNFT} from "../interfaces/IChapterNFT.sol";
import {DataTypes} from "../libraries/DataTypes.sol";

/// @title ChapterNFT
/// @notice ERC-721 + ERC-2981 NFT for chapter copyright proof. One global contract for all novels.
/// @dev Only the authorized NovelCore contract can mint NFTs. Supports EIP-2981 royalties.
contract ChapterNFT is
    Initializable,
    ERC721Upgradeable,
    ERC2981Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IChapterNFT
{
    using Strings for uint256;

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

    /// @notice Base URI for token metadata (e.g., "https://api.example.com/nft/")
    string private _baseTokenURI;

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
        __ERC2981_init();
        __Ownable_init(owner_);

        novelCore = novelCore_;
        _nextTokenId = 1;

        // Default royalty: 5% to contract owner (can be changed later)
        _setDefaultRoyalty(owner_, 500);
    }

    // ============================================================
    //                     ADMIN FUNCTIONS
    // ============================================================

    /// @notice Update the authorized NovelCore address (for upgrades)
    function setNovelCore(address newNovelCore) external onlyOwner {
        novelCore = newNovelCore;
    }

    /// @notice Set the base URI for token metadata
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    /// @notice Set the default royalty for all tokens
    /// @param receiver Address that receives royalty payments
    /// @param feeNumerator Royalty fee in basis points (e.g., 500 = 5%)
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    /// @notice Set royalty for a specific token (overrides default)
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
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

        // Set per-token royalty: author receives 5% of secondary sales
        _setTokenRoyalty(tokenId, to, 500);

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

    /// @notice Returns the token URI for a given token ID
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist(tokenId);

        string memory base = _baseTokenURI;
        if (bytes(base).length > 0) {
            return string.concat(base, tokenId.toString());
        }

        // Fallback: return a data URI with on-chain metadata
        DataTypes.ChapterNFTMetadata memory meta = _chapterMetadata[tokenId];
        return string.concat(
            "data:application/json,{\"name\":\"Chapter #",
            meta.chapterId.toString(),
            "\",\"description\":\"Canon chapter from Novel #",
            meta.novelId.toString(),
            ", Epoch ",
            uint256(meta.epoch).toString(),
            "\"}"
        );
    }

    // ============================================================
    //                   ERC-165 SUPPORT
    // ============================================================

    /// @dev Override required by Solidity for multiple inheritance
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ============================================================
    //                     UUPS UPGRADE
    // ============================================================

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================================
    //                    STORAGE GAP
    // ============================================================

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;
}
