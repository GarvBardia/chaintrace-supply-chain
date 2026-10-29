const { expect } = require("chai");
const { ethers } = require("hardhat");

const Role = { None: 0, Manufacturer: 1, Distributor: 2, Retailer: 3 };
const Stage = {
  Manufactured: 0,
  ShippedToDistributor: 1,
  ReceivedByDistributor: 2,
  ShippedToRetailer: 3,
  ReceivedByRetailer: 4,
  Sold: 5,
};

describe("SupplyChainTracker", function () {
  let sc, admin, maker, dist, retail, stranger;

  beforeEach(async function () {
    [admin, maker, dist, retail, stranger] = await ethers.getSigners();
    sc = await (await ethers.getContractFactory("SupplyChainTracker")).deploy();
    await sc.setRole(maker.address, Role.Manufacturer);
    await sc.setRole(dist.address, Role.Distributor);
    await sc.setRole(retail.address, Role.Retailer);
  });

  const register = () =>
    sc.connect(maker).registerProduct("Organic Coffee", "BATCH-001", "QmExampleCID", "Coorg Estate");

  describe("roles & admin", function () {
    it("sets deployer as admin", async () => {
      expect(await sc.admin()).to.equal(admin.address);
    });
    it("only admin can set roles", async () => {
      await expect(sc.connect(stranger).setRole(stranger.address, Role.Retailer)).to.be.revertedWithCustomError(
        sc,
        "NotAdmin"
      );
    });
    it("rejects zero address role", async () => {
      await expect(sc.setRole(ethers.ZeroAddress, Role.Retailer)).to.be.revertedWithCustomError(sc, "ZeroAddress");
    });
    it("can revoke a role", async () => {
      await sc.setRole(maker.address, Role.None);
      await expect(register()).to.be.revertedWithCustomError(sc, "MissingRole");
    });
    it("transfers admin", async () => {
      await sc.transferAdmin(stranger.address);
      expect(await sc.admin()).to.equal(stranger.address);
      await expect(sc.setRole(maker.address, Role.None)).to.be.revertedWithCustomError(sc, "NotAdmin");
    });
  });

  describe("registration", function () {
    it("registers a product and logs history", async () => {
      await expect(register()).to.emit(sc, "ProductRegistered").withArgs(1, maker.address, "Organic Coffee", "BATCH-001");
      const p = await sc.getProduct(1);
      expect(p.name).to.equal("Organic Coffee");
      expect(p.currentOwner).to.equal(maker.address);
      expect(p.stage).to.equal(Stage.Manufactured);
      const h = await sc.getHistory(1);
      expect(h.length).to.equal(1);
      expect(h[0].location).to.equal("Coorg Estate");
    });
    it("only manufacturers can register", async () => {
      await expect(
        sc.connect(dist).registerProduct("x", "y", "", "z")
      ).to.be.revertedWithCustomError(sc, "MissingRole");
    });
    it("rejects empty name", async () => {
      await expect(sc.connect(maker).registerProduct("", "B", "", "L")).to.be.revertedWithCustomError(sc, "EmptyInput");
    });
    it("increments ids", async () => {
      await register();
      await register();
      expect(await sc.productCount()).to.equal(2);
    });
    it("reverts for unknown product", async () => {
      await expect(sc.getProduct(99)).to.be.revertedWithCustomError(sc, "ProductNotFound");
      await expect(sc.getProduct(0)).to.be.revertedWithCustomError(sc, "ProductNotFound");
    });
  });

  describe("full lifecycle", function () {
    it("moves Manufacturer -> Distributor -> Retailer -> Sold", async () => {
      await register();

      await sc.connect(maker).shipProduct(1, dist.address, "Bengaluru Warehouse");
      let p = await sc.getProduct(1);
      expect(p.stage).to.equal(Stage.ShippedToDistributor);
      expect(p.pendingOwner).to.equal(dist.address);
      expect(p.currentOwner).to.equal(maker.address);

      await sc.connect(dist).receiveProduct(1, "Mysuru Hub");
      p = await sc.getProduct(1);
      expect(p.stage).to.equal(Stage.ReceivedByDistributor);
      expect(p.currentOwner).to.equal(dist.address);
      expect(p.pendingOwner).to.equal(ethers.ZeroAddress);

      await sc.connect(dist).shipProduct(1, retail.address, "Mysuru Hub");
      await sc.connect(retail).receiveProduct(1, "Store #12");
      p = await sc.getProduct(1);
      expect(p.stage).to.equal(Stage.ReceivedByRetailer);

      await expect(sc.connect(retail).markSold(1, "Store #12")).to.emit(sc, "ProductSold").withArgs(1, retail.address);
      p = await sc.getProduct(1);
      expect(p.stage).to.equal(Stage.Sold);

      const h = await sc.getHistory(1);
      expect(h.length).to.equal(6);
      expect(h.map((r) => Number(r.stage))).to.deep.equal([0, 1, 2, 3, 4, 5]);
    });
  });

  describe("access control & state machine", function () {
    beforeEach(register);

    it("only owner can ship", async () => {
      await expect(sc.connect(stranger).shipProduct(1, dist.address, "")).to.be.revertedWithCustomError(
        sc,
        "NotCurrentOwner"
      );
    });
    it("cannot ship to wrong role", async () => {
      await expect(sc.connect(maker).shipProduct(1, retail.address, "")).to.be.revertedWithCustomError(
        sc,
        "WrongRecipientRole"
      );
      await expect(sc.connect(maker).shipProduct(1, stranger.address, "")).to.be.revertedWithCustomError(
        sc,
        "WrongRecipientRole"
      );
    });
    it("cannot ship to zero address", async () => {
      await expect(sc.connect(maker).shipProduct(1, ethers.ZeroAddress, "")).to.be.revertedWithCustomError(
        sc,
        "ZeroAddress"
      );
    });
    it("only the named recipient can receive", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "");
      await expect(sc.connect(stranger).receiveProduct(1, "")).to.be.revertedWithCustomError(sc, "NotPendingOwner");
    });
    it("cannot receive before shipping", async () => {
      await expect(sc.connect(dist).receiveProduct(1, "")).to.be.revertedWithCustomError(sc, "NotPendingOwner");
    });
    it("cannot ship twice", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "");
      await expect(sc.connect(maker).shipProduct(1, dist.address, "")).to.be.revertedWithCustomError(
        sc,
        "InvalidStage"
      );
    });
    it("cannot skip stages / sell early", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "");
      await sc.connect(dist).receiveProduct(1, "");
      await expect(sc.connect(dist).markSold(1, "")).to.be.revertedWithCustomError(sc, "MissingRole");
    });
    it("only retailer holding the product can sell", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "");
      await sc.connect(dist).receiveProduct(1, "");
      await sc.connect(dist).shipProduct(1, retail.address, "");
      // still in transit: the distributor is the owner, so the retailer cannot sell yet
      await expect(sc.connect(retail).markSold(1, "")).to.be.revertedWithCustomError(sc, "NotCurrentOwner");
      await sc.connect(retail).receiveProduct(1, "");
      await sc.connect(retail).markSold(1, "");
      await expect(sc.connect(retail).markSold(1, "")).to.be.revertedWithCustomError(sc, "InvalidStage");
    });
  });

  describe("cancel shipment", function () {
    beforeEach(register);
    it("sender can cancel before receipt and history is kept", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "A");
      await expect(sc.connect(maker).cancelShipment(1, "A")).to.emit(sc, "ShipmentCancelled");
      const p = await sc.getProduct(1);
      expect(p.stage).to.equal(Stage.Manufactured);
      expect(p.pendingOwner).to.equal(ethers.ZeroAddress);
      expect(await sc.getHistoryLength(1)).to.equal(3);
      await expect(sc.connect(dist).receiveProduct(1, "")).to.be.revertedWithCustomError(sc, "NotPendingOwner");
    });
    it("cannot cancel when nothing is in transit", async () => {
      await expect(sc.connect(maker).cancelShipment(1, "")).to.be.revertedWithCustomError(sc, "InvalidStage");
    });
    it("only owner can cancel", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "");
      await expect(sc.connect(stranger).cancelShipment(1, "")).to.be.revertedWithCustomError(sc, "NotCurrentOwner");
    });
  });

  describe("recall", function () {
    beforeEach(register);
    it("manufacturer can recall and product is frozen", async () => {
      await expect(sc.connect(maker).recallProduct(1, "Contamination")).to.emit(sc, "ProductRecalled");
      expect((await sc.getProduct(1)).recalled).to.equal(true);
      await expect(sc.connect(maker).shipProduct(1, dist.address, "")).to.be.revertedWithCustomError(
        sc,
        "ProductIsRecalled"
      );
    });
    it("admin can recall", async () => {
      await sc.recallProduct(1, "Regulator order");
      expect((await sc.getProduct(1)).recalled).to.equal(true);
    });
    it("strangers cannot recall; no double recall; reason required", async () => {
      await expect(sc.connect(stranger).recallProduct(1, "x")).to.be.revertedWithCustomError(sc, "NotAllowedToRecall");
      await expect(sc.connect(maker).recallProduct(1, "")).to.be.revertedWithCustomError(sc, "EmptyInput");
      await sc.connect(maker).recallProduct(1, "r");
      await expect(sc.connect(maker).recallProduct(1, "r")).to.be.revertedWithCustomError(sc, "AlreadyRecalled");
    });
    it("recall in transit blocks receipt", async () => {
      await sc.connect(maker).shipProduct(1, dist.address, "");
      await sc.connect(maker).recallProduct(1, "Defect");
      await expect(sc.connect(dist).receiveProduct(1, "")).to.be.revertedWithCustomError(sc, "ProductIsRecalled");
    });
  });

  describe("pausable", function () {
    it("pause blocks actions, unpause restores", async () => {
      await sc.pause();
      await expect(register()).to.be.revertedWithCustomError(sc, "ContractPaused");
      await sc.unpause();
      await register();
    });
    it("only admin can pause", async () => {
      await expect(sc.connect(stranger).pause()).to.be.revertedWithCustomError(sc, "NotAdmin");
    });
  });

  describe("pagination", function () {
    it("returns pages of products", async () => {
      for (let i = 0; i < 5; i++) await register();
      expect((await sc.getProducts(1, 3)).length).to.equal(3);
      expect((await sc.getProducts(4, 10)).length).to.equal(2);
      expect((await sc.getProducts(10, 3)).length).to.equal(0);
    });
  });
});
