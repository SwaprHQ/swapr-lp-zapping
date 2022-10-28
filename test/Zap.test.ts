// @ts-ignore
import { ethers, network, waffle } from "hardhat"
import { expect } from "chai"
import { BigNumber, constants } from "ethers"
import { DXswapFactory, DXswapPair, DXswapRouter, ERC20, IERC20, WETH9, WXDAI, Zap } from "../typechain"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { dxswapFixture } from "./shared/fixtures"
import { Address } from "hardhat-deploy/types"
import { calculateAmountsOut } from "./shared/utilities"

const amountIn = ethers.utils.parseEther("1")
const { AddressZero, MaxUint256 } = constants
const dexIndex1 = BigNumber.from(1)
const dexIndex2 = BigNumber.from(2)
const dexIndex3 = BigNumber.from(3)

const overrides = {
  gasLimit: 9999999
}

// Using a Round error exception of 0.00000000000001 in ETH Unit, this equals 10000 in WEI unit, same value used as denominator for swap fee calculation 
const ROUND_EXCEPTION = BigNumber.from(10).pow(4)

const USER_ACCOUNT = "0xe716EC63C5673B3a4732D22909b38d779fa47c3F" //dao avatar as example user

describe.only("Zap", function () {
  let zap: Zap
  let dxswapRouter: DXswapRouter
  let dex2Router: DXswapRouter
  let dex3Router: DXswapRouter

  let dxswapFactory: DXswapFactory
  let dex2Factory: DXswapFactory
  let dex3Factory: DXswapFactory

  let WETH: WETH9
  let WXDAI: WXDAI
  let GNO: ERC20
  let DXD: ERC20
  let SWPR: ERC20
  let COW: ERC20

  let wethXdai: DXswapPair
  let swprXdai: DXswapPair
  let wethGno: DXswapPair
  let gnoXdai: DXswapPair
  let gnoDxd: DXswapPair
  let dxdWeth: DXswapPair
  let cowWeth: DXswapPair

  // wallets
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let feeReceiver: SignerWithAddress
  let impersonated: SignerWithAddress
  let feeSetter: SignerWithAddress
  let randomSigner: SignerWithAddress
  let FEE_TO_SETTER: Address

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    user = signers[1]
    feeReceiver = signers[2]
    randomSigner = signers[3]
  })
  
  beforeEach('deploy fixture', async function () {
    const fixture = await dxswapFixture(owner)
    zap = fixture.zap
    dxswapRouter = fixture.dxswapRouter
    dex2Router = fixture.dex2Router
    dex3Router = fixture.dex3Router
    dxswapFactory = fixture.dxswapFactory
    dex2Factory = fixture.dex2Factory
    dex3Factory = fixture.dex3Factory
    
    WETH = fixture.WETH
    WXDAI = fixture.WXDAI
    GNO = fixture.GNO
    DXD = fixture.DXD
    SWPR = fixture.SWPR
    COW = fixture.COW
    
    wethXdai = fixture.wethXdai
    swprXdai = fixture.swprXdai
    wethGno = fixture.wethGno
    gnoXdai = fixture.gnoXdai
    gnoDxd = fixture.gnoDxd
    dxdWeth = fixture.dxdWeth
    cowWeth = fixture.cowWeth
    FEE_TO_SETTER = fixture.FEE_TO_SETTER
  })

  beforeEach('impersonate accounts', async function () {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USER_ACCOUNT],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [FEE_TO_SETTER],
    });

    impersonated = await ethers.getSigner(USER_ACCOUNT)
    feeSetter = await ethers.getSigner(FEE_TO_SETTER)
    // set fee setter account balance to 100 ETH
    await network.provider.send("hardhat_setBalance", [FEE_TO_SETTER, "0x56bc75e2d63100000"])
  })

  this.beforeEach('set supported dexs', async function () {
    await zap.connect(owner).setSupportedDEX(dexIndex1, 'dex1', dxswapRouter.address, dxswapFactory.address, overrides);
    await zap.connect(owner).setSupportedDEX(dexIndex2, 'dex2', dex2Router.address, dex2Factory.address, overrides);
    await zap.connect(owner).setSupportedDEX(dexIndex3, 'dex3', dex3Router.address, dex3Factory.address, overrides);
  })

  describe("Revert", function () {
    it("Set supported dexs", async function () {
      expect(await (await zap.connect(impersonated).supportedDEXs(dexIndex1)).factory
      ).to.be.equal(dxswapFactory.address)
      expect(await (await zap.connect(impersonated).supportedDEXs(dexIndex2)).router
      ).to.be.equal(dex2Router.address)
      expect(await (await zap.connect(impersonated).supportedDEXs(dexIndex3)).name
      ).to.be.equal('dex3')
    })

    it("Revert on zapIn", async function () {
      let amountOut = await getAmountOut(WXDAI.address, gnoXdai)

      await expect(
        zap.connect(impersonated).zapIn(
          {amount: 0, amountMin: 0, path:[WXDAI.address, GNO.address] , dexIndex: dexIndex1}, 
          {amount: 0, amountMin: 0, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
          {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex3, to: impersonated.address}, 
          impersonated.address, 
          true
          )
      ).to.be.revertedWith("InvalidInputAmount()")
          
      await expect(
        zap.connect(impersonated).zapIn(
          {amount: 0, amountMin: 0, path:[AddressZero, GNO.address] , dexIndex: dexIndex1}, 
          {amount: 0, amountMin: 0, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
          {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex3, to: impersonated.address}, 
          impersonated.address, 
          true,
          {value: 0, gasLimit: 9999999}
          )
      ).to.be.revertedWith("InvalidInputAmount()")

      await expect(
        zap.connect(impersonated).zapIn(
          {amount: amountIn, amountMin: 0, path:[COW.address, GNO.address] , dexIndex: dexIndex1}, 
          {amount: amountIn, amountMin: 0, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
          {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex3, to: impersonated.address}, 
          impersonated.address, 
          true
          )
      ).to.be.revertedWith("InvalidStartPath()")

      await expect(
      zap.connect(impersonated).zapOut(
        amountIn, 0,
        {amount: amountIn, amountMin: 0, path:[WXDAI.address, GNO.address] , dexIndex: dexIndex1}, 
        {amount: amountIn, amountMin: 0, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex3, to: impersonated.address}, 
        impersonated.address,
        impersonated.address
        )
    ).to.be.revertedWith("InvalidTargetPath()")

      await expect(
        zap.connect(owner).setSupportedDEX(dexIndex3, 'dex3', dex3Router.address, dex3Factory.address, overrides)
      ).to.be.revertedWith('DexIndexAlreadyUsed()')
      await expect(
        zap.connect(owner).setSupportedDEX(BigNumber.from(10), 'dex3', AddressZero, dex3Factory.address, overrides)
      ).to.be.revertedWith('ZeroAddressInput()')
      await expect(
        zap.connect(owner).setSupportedDEX(BigNumber.from(12), 'dex3', dex3Router.address, AddressZero, overrides)
      ).to.be.revertedWith('ZeroAddressInput()')
      await expect(
        zap.connect(owner).setSupportedDEX(BigNumber.from(6), 'dex3', dex3Router.address, dex2Factory.address, overrides)
      ).to.be.revertedWith('InvalidRouterOrFactory()')

      await expect(
        zap.connect(impersonated).getSupportedDEX(BigNumber.from(81))
      ).to.be.revertedWith("InvalidRouterOrFactory()")

      await expect(
        zap.connect(owner).setNewAffiliateSplit(BigNumber.from(10001))
      ).to.be.revertedWith("ForbiddenValue()")
    })
    

  
  })


  describe("Token", function () {
    it("zap in dxd token to dxd/weth and zap out to native currency: xdai", async function () {
    zap.connect(impersonated).zapIn(
      {amount: amountIn, amountMin: 0, path:[DXD.address] , dexIndex: dexIndex1}, 
      {amount: amountIn, amountMin: 0, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
      {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
      impersonated.address, 
      true,
      {value: 0, gasLimit: 9999999}
      )
    })
  })
  
  // reset back to a fresh forked state
  after(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    })
  })
})

const getAmountOut = async (tokenIn: string, pair: DXswapPair) => {
  const reserves = await pair.getReserves()
  const token0 = await pair.token0()
  let reserveOut = reserves[0]
  let reserveIn = reserves[1]

  if (tokenIn == token0) {
    reserveOut=reserves[1]
    reserveIn=reserves[0]
  }

  return reserveOut.mul(amountIn).div(reserveIn.add(amountIn))
}
