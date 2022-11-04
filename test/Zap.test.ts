// @ts-ignore
import { ethers, network, waffle } from "hardhat"
import { expect } from "chai"
import { BigNumber, constants, ContractTransaction } from "ethers"
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
        {amountLpFrom: 0, amountTokenToMin: 0, dexIndex: dexIndex3, to: impersonated.address}, 
        {amount: amountIn, amountMin: 0, path:[WXDAI.address, GNO.address] , dexIndex: dexIndex1}, 
        {amount: amountIn, amountMin: 0, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
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

  describe("Supported DEXs", function () {
    it("Set supported dexs", async function () {
      expect((await zap.connect(impersonated).supportedDEXs(dexIndex1)).factory
      ).to.be.equal(dxswapFactory.address)
      expect((await zap.connect(impersonated).supportedDEXs(dexIndex2)).router
      ).to.be.equal(dex2Router.address)
      expect((await zap.connect(impersonated).supportedDEXs(dexIndex3)).name
      ).to.be.equal('dex3')
    })
  })

  describe("Protocol fee", function () {
    it("Initial addresses", async function () {
      expect(await zap.feeTo()).to.eq(AddressZero)
      expect((await zap.feeToSetter()).toLowerCase()).to.eq(FEE_TO_SETTER)
      expect(await zap.protocolFee()).to.eq(50)
    })
    it("Revert if caller is not owner", async function () {
      await expect(zap.connect(impersonated).setFeeTo(user.address, overrides))
      .to.be.revertedWith("OnlyFeeSetter()")
      await expect(zap.connect(impersonated).setFeeToSetter(user.address, overrides))
      .to.be.revertedWith("OnlyFeeSetter()")
      await expect(zap.connect(impersonated).setProtocolFee(100, overrides))
      .to.be.revertedWith("OnlyFeeSetter()")
    })
    it("Revert if invalid fee value", async function () {
      await expect(zap.connect(feeSetter).setProtocolFee(BigNumber.from(11000), overrides))
      .to.be.revertedWith("ForbiddenValue()")
    })
    it("Set protocol fee", async function () {
      await zap.connect(feeSetter).setProtocolFee(BigNumber.from(100), overrides)
      await zap.connect(feeSetter).setFeeTo(user.address, overrides)
      await zap.connect(feeSetter).setFeeToSetter(user.address, overrides)
      await zap.connect(user).setFeeToSetter(feeReceiver.address, overrides)

      expect(await zap.protocolFee()).to.eq(100)
      expect((await zap.feeTo()).toLowerCase()).to.eq(user.address.toLowerCase())
      expect((await zap.feeToSetter()).toLowerCase()).to.eq(feeReceiver.address.toLowerCase())
    })
  })

  describe("Protocol fee & affiliate", function (){
    it("feeWhitelist", async function () {
      expect(await zap.feeWhitelist(impersonated.address)).to.eq(false)
    })
    it("set feeWhitelist", async function () {
      expect(await zap.feeWhitelist(user.address)).to.eq(false)
      await zap.setFeeWhitelist(user.address, true)
      expect(await zap.feeWhitelist(user.address)).to.eq(true)
      await zap.setFeeWhitelist(user.address, false)
      expect(await zap.feeWhitelist(user.address)).to.eq(false)
    })
    it("revert ownable feeWhitelist", async function () {
      await expect(zap.connect(randomSigner).setFeeWhitelist(user.address,true,overrides)).to.be.revertedWith('OnlyOwner()')
    })

    it("set affliate", async function () {
      const _newAffliateSplit = BigNumber.from(2000)
      expect(await zap.affiliateSplit()).to.eq(0)
      await zap.setNewAffiliateSplit(_newAffliateSplit)
      expect(await zap.affiliateSplit()).to.eq(_newAffliateSplit)
    })
    it("revert ownable affliateSplit", async function () {
      await expect(zap.connect(randomSigner).setNewAffiliateSplit(BigNumber.from(2000))).to.be.revertedWith('OnlyOwner()')
    })

    it("zap in protocol fee on & address is not whitelisted", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const protocolFeeForZap = await zap.protocolFee()
      expect(protocolFeeForZap).to.be.above(0)

      // unlist user to check if protocol fee was taken
      await zap.setFeeWhitelist(impersonated.address, false)
      expect(await zap.feeWhitelist(impersonated.address)).to.eq(false)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const zapTokenBalance = await DXD.balanceOf(zap.address)
      const zapFeeTaken = (totalAmount.mul(protocolFeeForZap)).div(BigNumber.from(10000))
      expect(zapTokenBalance).to.be.eq(zapFeeTaken)
    })

    it("zap in with protocl fee on & address whitelisted", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const protocolFeeForZap = await zap.protocolFee()
      expect(protocolFeeForZap).to.be.above(0)
      await zap.setFeeWhitelist(impersonated.address, true)
      expect(await zap.feeWhitelist(impersonated.address)).to.eq(true)

      let zapTokenBalanceInit = await DXD.balanceOf(zap.address)
      expect(zapTokenBalanceInit).to.be.eq(0)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      let zapTokenBalance = await DXD.balanceOf(zap.address)
      expect(zapTokenBalance).to.be.eq(0)   
    })

    it("zap in protocol fee on & address is not whitelisted & affiliate on", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const _newAffliateSplit = BigNumber.from(2000)
      await zap.setNewAffiliateSplit(_newAffliateSplit)
      const affliateSplit = await zap.affiliateSplit()
      expect(affliateSplit).to.eq(_newAffliateSplit)
      await zap.setAffiliateStatus(randomSigner.address, true)
      expect(await zap.affiliates(randomSigner.address)).to.eq(true)
      
      const protocolFeeForZap = await zap.protocolFee()
      expect(protocolFeeForZap).to.be.above(0)

      // unlist user to check if protocol fee was taken
      await zap.setFeeWhitelist(impersonated.address, false)
      expect(await zap.feeWhitelist(impersonated.address)).to.eq(false)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        randomSigner.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const zapTokenBalance = await DXD.balanceOf(zap.address)
      const zapFeeTaken = (totalAmount.mul(protocolFeeForZap)).div(BigNumber.from(10000))
      expect(zapTokenBalance).to.be.eq(zapFeeTaken)
      const affliateBalance = await zap.affiliateBalance(randomSigner.address, DXD.address)
      const affliateTaken = (zapFeeTaken.mul(affliateSplit)).div(BigNumber.from(10000))
      expect(affliateBalance).to.be.eq(affliateTaken)
    })


  })


  describe("Zap In", function () {
    it("zap in dxd token to dxd/weth", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await dxdWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      const lpBalance = await dxdWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, DXD.address, totalAmount, dxdWeth.address, lpBought)
    })


    it("zap in dxd token to gno/xdai", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await gnoXdai.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address, GNO.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WXDAI.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      const lpBalance = await gnoXdai.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, DXD.address, totalAmount, gnoXdai.address, lpBought)
    })

    it("zap in wxdai token to cow/weth", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[WXDAI.address, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      const lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, WXDAI.address, totalAmount, cowWeth.address, lpBought)
    })

    it("zap in native currency (xdai) token to cow/weth", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[AddressZero, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: totalAmount, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      const lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      const nativeCurrencyBalance = await impersonated.getBalance()
      
      expect(lpBought).to.be.above(0)
      expect(nativeCurrencyBalanceInit).to.be.above(nativeCurrencyBalance)

      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, AddressZero, totalAmount, cowWeth.address, lpBought)
    })

  })

  describe("Zap Out", function () {
    it("zap in dxd token to dxd/weth and zap out to wxdai", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await dxdWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      let lpBalance = await dxdWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, DXD.address, totalAmount, dxdWeth.address, lpBought)
      
      const tokenOutBalanceInit = await WXDAI.balanceOf(impersonated.address) 

      await dxdWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: 0, dexIndex: dexIndex1, to: impersonated.address},
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [DXD.address, WXDAI.address] },
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [WETH.address, WXDAI.address] },
        impersonated.address,
        overrides
      )
      
      lpBalance = await dxdWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)

      const tokenOutBalance = await WXDAI.balanceOf(impersonated.address) 

      expect(tokenOutBalance).to.be.above(tokenOutBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, dxdWeth.address, lpBought, WXDAI.address, tokenOutBalance.sub(tokenOutBalanceInit))

    })


    it("zap in dxd token to gno/wxdai and zap out to wxdai", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await gnoXdai.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[DXD.address, GNO.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [DXD.address, WXDAI.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      let lpBalance = await gnoXdai.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, DXD.address, totalAmount, gnoXdai.address, lpBought)

      const tokenOutBalanceInit = await WXDAI.balanceOf(impersonated.address) 

      await gnoXdai.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: 0, dexIndex: dexIndex1, to: impersonated.address},
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [WXDAI.address] },
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [GNO.address, WXDAI.address] },
        impersonated.address,
        overrides
      )
      
      lpBalance = await gnoXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)

      const tokenOutBalance = await WXDAI.balanceOf(impersonated.address) 

      expect(tokenOutBalance).to.be.above(tokenOutBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, gnoXdai.address, lpBought, WXDAI.address, tokenOutBalance.sub(tokenOutBalanceInit))
    })

    it("zap in wxdai token to cow/weth and zap out to native currency", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[WXDAI.address, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: 0, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      let lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, WXDAI.address, totalAmount, cowWeth.address, lpBought)


      const nativeCurrencyBalanceBeforeZapOut = await impersonated.getBalance()

      await cowWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: 0, dexIndex: dexIndex1, to: impersonated.address},
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [COW.address, WETH.address, AddressZero] },
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [WETH.address, AddressZero] },
        impersonated.address,
        overrides
      )
      
      const { ethSpendForTx, eventArgValue: eventAmountTo} = await getTxData(txZapOut, "amountTo")

      
      const nativeCurrencyBalanceAfterZapOut = await impersonated.getBalance()   
      console.log('after', nativeCurrencyBalanceAfterZapOut)
      console.log('befor', nativeCurrencyBalanceBeforeZapOut)
      console.log('amoun', eventAmountTo)
      console.log('spend', ethSpendForTx)
      // expect(nativeCurrencyBalanceAfterZapOut).to.be.eq(nativeCurrencyBalanceBeforeZapOut.sub(ethSpendForTx).add(eventAmountTo))
      expect(nativeCurrencyBalanceAfterZapOut).to.be.above(nativeCurrencyBalanceBeforeZapOut)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, cowWeth.address, lpBought, AddressZero, eventAmountTo)
    })

    it("zap in native currency (xdai) token to cow/weth and zap out to natice currency", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[AddressZero, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: totalAmount, gasLimit: 9999999}
      )
         
      let lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      const nativeCurrencyBalance = await impersonated.getBalance()
      
      expect(lpBought).to.be.above(0)
      expect(nativeCurrencyBalanceInit).to.be.above(nativeCurrencyBalance)

      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, AddressZero, totalAmount, cowWeth.address, lpBought)

      const nativeCurrencyBalanceBeforeZapOut = await impersonated.getBalance()

      await cowWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: 0, dexIndex: dexIndex1, to: impersonated.address},
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [COW.address, WETH.address, AddressZero] },
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [WETH.address, AddressZero] },
        impersonated.address,
        overrides
      )
      
      const { ethSpendForTx, eventArgValue: eventAmountTo} = await getTxData(txZapOut, "amountTo")

      
      const nativeCurrencyBalanceAfterZapOut = await impersonated.getBalance()   
      console.log('initt', nativeCurrencyBalanceInit)
      console.log('befor', nativeCurrencyBalanceBeforeZapOut)
      console.log('after', nativeCurrencyBalanceAfterZapOut)
      console.log('amoun', eventAmountTo)
      console.log('spend', ethSpendForTx)
      // expect(nativeCurrencyBalanceAfterZapOut).to.be.eq(nativeCurrencyBalanceBeforeZapOut.sub(ethSpendForTx).add(eventAmountTo))
      expect(nativeCurrencyBalanceAfterZapOut).to.be.above(nativeCurrencyBalanceBeforeZapOut)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, cowWeth.address, lpBought, AddressZero, eventAmountTo)
    })

    it("zap in native currency (xdai) token to cow/weth and zap out to wrapped natice currency", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amount: totalAmount.div(2), amountMin: 0, path:[AddressZero, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: 0, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
        {amountAMin: 0, amountBMin: 0, amountLPMin: 0, dexIndex: dexIndex1, to: impersonated.address}, 
        impersonated.address, 
        true,
        {value: totalAmount, gasLimit: 9999999}
      )
         
      let lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      const nativeCurrencyBalance = await impersonated.getBalance()
      
      expect(lpBought).to.be.above(0)
      expect(nativeCurrencyBalanceInit).to.be.above(nativeCurrencyBalance)

      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, AddressZero, totalAmount, cowWeth.address, lpBought)

      const tokenOutBalanceBeforeZapOut = await WXDAI.balanceOf(impersonated.address)
      
      await cowWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: 0, dexIndex: dexIndex1, to: impersonated.address},
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [COW.address, WETH.address, WXDAI.address] },
        {amount: 0, amountMin: 0, dexIndex: dexIndex1, path: [WETH.address, WXDAI.address] },
        impersonated.address,
        overrides
        )
        
      const { ethSpendForTx, eventArgValue: eventAmountTo} = await getTxData(txZapOut, "amountTo")
        
        
      const tokenOutBalanceAfterZapOut = await WXDAI.balanceOf(impersonated.address)
      const nativeCurrencyBalanceAfterZapOut = await impersonated.getBalance()   

      // expect(nativeCurrencyBalanceAfterZapOut).to.be.eq(nativeCurrencyBalanceBeforeZapOut.sub(ethSpendForTx).add(eventAmountTo))
      expect(nativeCurrencyBalanceAfterZapOut).to.be.below(nativeCurrencyBalanceInit)
      expect(eventAmountTo).to.be.eq(tokenOutBalanceAfterZapOut.sub(tokenOutBalanceBeforeZapOut))
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, cowWeth.address, lpBought, WXDAI.address, eventAmountTo)
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

const getTxData = async (tx: ContractTransaction, eventArg: string): Promise<{ethSpendForTx: BigNumber; eventArgValue: BigNumber}> => {
  const txReceipt = await tx.wait();
  const event = txReceipt.events && txReceipt.events.find(e => e.event === 'ZapOut');
  const eventArgValue = BigNumber.from( event?.args && event?.args[eventArg])
  const ethSpendForTx = txReceipt.gasUsed.mul(txReceipt.effectiveGasPrice)
  return { ethSpendForTx, eventArgValue }
}
