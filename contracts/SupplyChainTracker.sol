// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  SupplyChainTracker
 * @notice End-to-end product provenance: Manufacturer -> Distributor -> Retailer -> Customer.
 *         Every hand-over is recorded on-chain with actor, location and timestamp, so anyone
 *         can verify a product's full journey without trusting a central database.
 *
 * Course concepts demonstrated (IT_4421):
 *   Module 2 : structs, enums, mappings, events, modifiers, custom errors, ABI-friendly getters
 *   Module 3 : design patterns (access control, state machine, pull-over-push hand-over,
 *              circuit breaker / pausable), gas saving (custom errors, calldata, packed
 *              struct fields, cached storage pointers)
 *   Module 4 : DApp backend consumed by an ethers.js frontend; IPFS CID stored as metadata
 *   Module 5 : trust-in-code (rules enforced by the contract, not by people), data
 *              permanence (append-only history), security countermeasures (see notes below)
 *
 * Security notes:
 *   - No ETH is held or sent, so there is no reentrancy surface.
 *   - Two-step custody transfer (ship -> receive) prevents shipping to a wrong or dead address.
 *   - Recalled products are frozen; history is append-only and can never be edited or deleted.
 *   - Admin can pause all state-changing actions in an emergency (circuit breaker).
 *   - Solidity 0.8.x has built-in overflow checks.
 */
contract SupplyChainTracker {
    // ---------------------------------------------------------------------
    //  Types
    // ---------------------------------------------------------------------

    enum Role {
        None,
        Manufacturer,
        Distributor,
        Retailer
    }

    // The product lifecycle is a strict state machine; stages only move forward.
    enum Stage {
        Manufactured,           // 0 - created by manufacturer
        ShippedToDistributor,   // 1 - in transit, waiting for distributor to confirm
        ReceivedByDistributor,  // 2 - distributor holds it
        ShippedToRetailer,      // 3 - in transit, waiting for retailer to confirm
        ReceivedByRetailer,     // 4 - retailer holds it
        Sold                    // 5 - sold to the end customer
    }

    struct Product {
        uint256 id;
        string name;
        string batchNumber;
        string metadataCID;      // IPFS CID for images / certificates (off-chain data, on-chain hash)
        address manufacturer;
        address currentOwner;
        address pendingOwner;    // non-zero only while a shipment is in transit
        Stage stage;             // packed with the fields below into one storage slot
        bool recalled;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Record {
        Stage stage;
        address actor;
        uint64 timestamp;
        string location;
        string note;
    }

    // ---------------------------------------------------------------------
    //  Storage
    // ---------------------------------------------------------------------

    address public admin;
    bool public paused;
    uint256 public productCount;

    mapping(address => Role) public roles;
    mapping(uint256 => Product) private products;
    mapping(uint256 => Record[]) private histories;

    // ---------------------------------------------------------------------
    //  Events (the indexed fields make the frontend / explorers able to filter)
    // ---------------------------------------------------------------------

    event RoleUpdated(address indexed account, Role role);
    event ProductRegistered(uint256 indexed productId, address indexed manufacturer, string name, string batchNumber);
    event ProductShipped(uint256 indexed productId, address indexed from, address indexed to, Stage stage);
    event ProductReceived(uint256 indexed productId, address indexed by, Stage stage);
    event ShipmentCancelled(uint256 indexed productId, address indexed by);
    event ProductSold(uint256 indexed productId, address indexed retailer);
    event ProductRecalled(uint256 indexed productId, address indexed by, string reason);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ---------------------------------------------------------------------
    //  Custom errors (cheaper than revert strings)
    // ---------------------------------------------------------------------

    error NotAdmin();
    error MissingRole(Role required);
    error ContractPaused();
    error ProductNotFound(uint256 productId);
    error NotCurrentOwner(uint256 productId);
    error NotPendingOwner(uint256 productId);
    error InvalidStage(uint256 productId, Stage current);
    error ProductIsRecalled(uint256 productId);
    error ZeroAddress();
    error EmptyInput();
    error WrongRecipientRole(Role required);
    error NotAllowedToRecall();
    error AlreadyRecalled(uint256 productId);

    // ---------------------------------------------------------------------
    //  Modifiers
    // ---------------------------------------------------------------------

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyRole(Role required) {
        if (roles[msg.sender] != required) revert MissingRole(required);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier productExists(uint256 productId) {
        if (productId == 0 || productId > productCount) revert ProductNotFound(productId);
        _;
    }

    // ---------------------------------------------------------------------
    //  Constructor
    // ---------------------------------------------------------------------

    constructor() {
        admin = msg.sender;
        emit AdminTransferred(address(0), msg.sender);
    }

    // ---------------------------------------------------------------------
    //  Administration
    // ---------------------------------------------------------------------

    /// @notice Grant (or change / revoke with Role.None) a participant's role.
    function setRole(address account, Role role) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        roles[account] = role;
        emit RoleUpdated(account, role);
    }

    /// @notice Circuit breaker: freeze all state-changing supply-chain actions.
    function pause() external onlyAdmin {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // ---------------------------------------------------------------------
    //  Supply-chain actions
    // ---------------------------------------------------------------------

    /// @notice Step 1 - Manufacturer registers a new product.
    function registerProduct(
        string calldata name,
        string calldata batchNumber,
        string calldata metadataCID,
        string calldata location
    ) external onlyRole(Role.Manufacturer) whenNotPaused returns (uint256 productId) {
        if (bytes(name).length == 0 || bytes(batchNumber).length == 0) revert EmptyInput();

        productId = ++productCount;

        products[productId] = Product({
            id: productId,
            name: name,
            batchNumber: batchNumber,
            metadataCID: metadataCID,
            manufacturer: msg.sender,
            currentOwner: msg.sender,
            pendingOwner: address(0),
            stage: Stage.Manufactured,
            recalled: false,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });

        _record(productId, Stage.Manufactured, location, "Product manufactured");
        emit ProductRegistered(productId, msg.sender, name, batchNumber);
    }

    /// @notice Step 2 / 4 - Current owner ships the product to the next party.
    ///         Manufacturer -> Distributor, then Distributor -> Retailer.
    function shipProduct(
        uint256 productId,
        address to,
        string calldata location
    ) external productExists(productId) whenNotPaused {
        Product storage p = products[productId];

        if (p.recalled) revert ProductIsRecalled(productId);
        if (p.currentOwner != msg.sender) revert NotCurrentOwner(productId);
        if (to == address(0)) revert ZeroAddress();

        Stage current = p.stage;
        Stage next;
        Role requiredRecipient;

        if (current == Stage.Manufactured) {
            next = Stage.ShippedToDistributor;
            requiredRecipient = Role.Distributor;
        } else if (current == Stage.ReceivedByDistributor) {
            next = Stage.ShippedToRetailer;
            requiredRecipient = Role.Retailer;
        } else {
            revert InvalidStage(productId, current);
        }

        if (roles[to] != requiredRecipient) revert WrongRecipientRole(requiredRecipient);

        p.pendingOwner = to;
        p.stage = next;
        p.updatedAt = uint64(block.timestamp);

        _record(productId, next, location, "Shipment dispatched");
        emit ProductShipped(productId, msg.sender, to, next);
    }

    /// @notice Step 3 / 5 - The named recipient confirms receipt (pull-based custody transfer).
    function receiveProduct(uint256 productId, string calldata location)
        external
        productExists(productId)
        whenNotPaused
    {
        Product storage p = products[productId];

        if (p.recalled) revert ProductIsRecalled(productId);
        if (p.pendingOwner != msg.sender) revert NotPendingOwner(productId);

        Stage current = p.stage;
        Stage next;

        if (current == Stage.ShippedToDistributor) {
            next = Stage.ReceivedByDistributor;
        } else if (current == Stage.ShippedToRetailer) {
            next = Stage.ReceivedByRetailer;
        } else {
            revert InvalidStage(productId, current);
        }

        p.currentOwner = msg.sender;
        p.pendingOwner = address(0);
        p.stage = next;
        p.updatedAt = uint64(block.timestamp);

        _record(productId, next, location, "Shipment received");
        emit ProductReceived(productId, msg.sender, next);
    }

    /// @notice Sender may cancel a shipment that has not been received yet (e.g. wrong address).
    function cancelShipment(uint256 productId, string calldata location)
        external
        productExists(productId)
        whenNotPaused
    {
        Product storage p = products[productId];

        if (p.currentOwner != msg.sender) revert NotCurrentOwner(productId);

        Stage current = p.stage;
        Stage previous;

        if (current == Stage.ShippedToDistributor) {
            previous = Stage.Manufactured;
        } else if (current == Stage.ShippedToRetailer) {
            previous = Stage.ReceivedByDistributor;
        } else {
            revert InvalidStage(productId, current);
        }

        p.pendingOwner = address(0);
        p.stage = previous;
        p.updatedAt = uint64(block.timestamp);

        // History is append-only: a cancellation is a new record, the old one is never erased.
        _record(productId, previous, location, "Shipment cancelled by sender");
        emit ShipmentCancelled(productId, msg.sender);
    }

    /// @notice Step 6 - Retailer marks the product as sold to the end customer.
    function markSold(uint256 productId, string calldata location)
        external
        productExists(productId)
        whenNotPaused
    {
        Product storage p = products[productId];

        if (roles[msg.sender] != Role.Retailer) revert MissingRole(Role.Retailer);
        if (p.recalled) revert ProductIsRecalled(productId);
        if (p.currentOwner != msg.sender) revert NotCurrentOwner(productId);
        if (p.stage != Stage.ReceivedByRetailer) revert InvalidStage(productId, p.stage);

        p.stage = Stage.Sold;
        p.updatedAt = uint64(block.timestamp);

        _record(productId, Stage.Sold, location, "Sold to customer");
        emit ProductSold(productId, msg.sender);
    }

    /// @notice The original manufacturer or the admin can recall a product. Recalled products
    ///         are frozen: they can no longer be shipped, received or sold.
    function recallProduct(uint256 productId, string calldata reason)
        external
        productExists(productId)
    {
        Product storage p = products[productId];

        if (msg.sender != admin && msg.sender != p.manufacturer) revert NotAllowedToRecall();
        if (p.recalled) revert AlreadyRecalled(productId);
        if (bytes(reason).length == 0) revert EmptyInput();

        p.recalled = true;
        p.updatedAt = uint64(block.timestamp);

        _record(productId, p.stage, "", reason);
        emit ProductRecalled(productId, msg.sender, reason);
    }

    // ---------------------------------------------------------------------
    //  Read functions (free to call, no gas)
    // ---------------------------------------------------------------------

    function getProduct(uint256 productId)
        external
        view
        productExists(productId)
        returns (Product memory)
    {
        return products[productId];
    }

    /// @notice Full journey of a product, oldest record first.
    function getHistory(uint256 productId)
        external
        view
        productExists(productId)
        returns (Record[] memory)
    {
        return histories[productId];
    }

    function getHistoryLength(uint256 productId)
        external
        view
        productExists(productId)
        returns (uint256)
    {
        return histories[productId].length;
    }

    /// @notice Paginated list so a frontend can load products in one call.
    function getProducts(uint256 start, uint256 count) external view returns (Product[] memory list) {
        if (start == 0) start = 1;
        if (start > productCount) return new Product[](0);

        uint256 end = start + count - 1;
        if (end > productCount) end = productCount;

        list = new Product[](end - start + 1);
        for (uint256 i = start; i <= end; ++i) {
            list[i - start] = products[i];
        }
    }

    // ---------------------------------------------------------------------
    //  Internal
    // ---------------------------------------------------------------------

    function _record(
        uint256 productId,
        Stage stage,
        string memory location,
        string memory note
    ) private {
        histories[productId].push(
            Record({
                stage: stage,
                actor: msg.sender,
                timestamp: uint64(block.timestamp),
                location: location,
                note: note
            })
        );
    }
}
