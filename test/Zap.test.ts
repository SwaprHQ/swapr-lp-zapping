// @ts-ignore
import { ethers, network, waffle } from "hardhat"
import { expect } from "chai"
import { BigNumber, constants, ContractTransaction } from "ethers"
import {
  Zap,
  ERC20,
  WETH9,
  WXDAI,
  TetherToken,
  DXswapPair,
  DXswapRouter,
  DXswapFactory,
  UniswapV2Pair,
  UniswapV2Factory,
  UniswapV2Router02
} from "../typechain"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { dxswapFixture } from "./shared/fixtures"
import { Address } from "hardhat-deploy/types"

const amountIn = ethers.utils.parseEther("1")
const { AddressZero } = constants
const dexIndex1 = BigNumber.from(1)
const dexIndex2 = BigNumber.from(2)
const dexIndex3 = BigNumber.from(3)
const uniswapV2Index4 = BigNumber.from(4)

const overrides = {
  gasLimit: 9999999
}

// Using a Round error exception of 0.00000000000001 in ETH Unit, this equals 10000 in WEI unit, same value used as denominator for swap fee calculation 
const ROUND_EXCEPTION = BigNumber.from(10).pow(4)
const zeroBN = BigNumber.from(0)

const USER_ACCOUNT = "0xe716EC63C5673B3a4732D22909b38d779fa47c3F" //dao avatar as example user
const RANDOM_TETHER_HOLDER = "0x7f90122BF0700F9E7e1F688fe926940E8839F353"

describe.only("Zap", function () {
  let zap: Zap
  let dxswapRouter: DXswapRouter
  let dex2Router: DXswapRouter
  let dex3Router: DXswapRouter
  let uniswapV2Router: UniswapV2Router02

  let dxswapFactory: DXswapFactory
  let dex2Factory: DXswapFactory
  let dex3Factory: DXswapFactory
  let uniswapV2Factory: UniswapV2Factory

  let WETH: WETH9
  let WXDAI: WXDAI
  let GNO: ERC20
  let DXD: ERC20
  let SWPR: ERC20
  let COW: ERC20
  let USDT: TetherToken
  let USDT_IMPLEMENTATION_ADDRESS: Address

  let wethXdai: DXswapPair
  let swprXdai: DXswapPair
  let wethGno: DXswapPair
  let gnoXdai: DXswapPair
  let gnoDxd: DXswapPair
  let dxdWeth: DXswapPair
  let cowWeth: DXswapPair
  let wxdaiWeth: UniswapV2Pair
  let usdtWeth: UniswapV2Pair
  let usdtWethDex2: DXswapPair

  let wethGnoDex3: DXswapPair

  // wallets
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let feeReceiver: SignerWithAddress
  let impersonated: SignerWithAddress
  let feeSetter: SignerWithAddress
  let randomSigner: SignerWithAddress
  let tetherHolder: SignerWithAddress
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
    uniswapV2Router = fixture.uniswapV2Router
    dxswapFactory = fixture.dxswapFactory
    dex2Factory = fixture.dex2Factory
    dex3Factory = fixture.dex3Factory
    uniswapV2Factory = fixture.uniswapV2Factory
    
    WETH = fixture.WETH
    WXDAI = fixture.WXDAI
    GNO = fixture.GNO
    DXD = fixture.DXD
    SWPR = fixture.SWPR
    COW = fixture.COW
    USDT = fixture.USDT
    USDT_IMPLEMENTATION_ADDRESS = fixture.USDT_IMPLEMENTATION_ADDRESS
    
    wethXdai = fixture.wethXdai
    swprXdai = fixture.swprXdai
    wethGno = fixture.wethGno
    gnoXdai = fixture.gnoXdai
    gnoDxd = fixture.gnoDxd
    dxdWeth = fixture.dxdWeth
    cowWeth = fixture.cowWeth
    wxdaiWeth = fixture.wxdaiWeth
    usdtWeth = fixture.usdtWeth
    usdtWethDex2 = fixture.usdtWethDex2

    wethGnoDex3 = fixture.wethGnoDex3

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
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [RANDOM_TETHER_HOLDER],
    })

    impersonated = await ethers.getSigner(USER_ACCOUNT)
    feeSetter = await ethers.getSigner(FEE_TO_SETTER)
    tetherHolder = await ethers.getSigner(RANDOM_TETHER_HOLDER)

    // set fee setter account balance to 100 ETH
    await network.provider.send("hardhat_setBalance", [FEE_TO_SETTER, "0x56bc75e2d63100000"])

    // send some tokens to address for gas fees
    await network.provider.send("hardhat_setBalance", [tetherHolder.address, "0x56bc75e2d63100000"])

    // replace proxy USDT with the actual contract bytecode
    const bytecode = await network.provider.send("eth_getCode", [USDT_IMPLEMENTATION_ADDRESS])
    await network.provider.send("hardhat_setCode", [USDT_IMPLEMENTATION_ADDRESS, bytecode])
  })

  this.beforeEach('set supported dexs', async function () {
    await zap.connect(owner).setSupportedDEX(dexIndex1, 'Swapr', dxswapRouter.address, dxswapFactory.address, overrides);
    await zap.connect(owner).setSupportedDEX(dexIndex2, 'dex2', dex2Router.address, dex2Factory.address, overrides);
    await zap.connect(owner).setSupportedDEX(dexIndex3, 'dex3', dex3Router.address, dex3Factory.address, overrides);
    await zap.connect(owner).setSupportedDEX(uniswapV2Index4, 'UniswapV2', uniswapV2Router.address, uniswapV2Factory.address, overrides);
  })
  
  describe("Revert", function () {
    it("revert on zapIn", async function () {
      await expect(
        zap.connect(impersonated).zapIn(
          {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex3}, 
          {amount: amountIn, amountMin: zeroBN, path:[COW.address, GNO.address] , dexIndex: dexIndex1}, 
          {amount: amountIn, amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
          impersonated.address,
          impersonated.address, 
          true
          )
      ).to.be.revertedWith("InvalidStartPath()")

      await expect(
        zap.connect(impersonated).zapOut(
          {amountLpFrom: zeroBN, amountTokenToMin: zeroBN, dexIndex: dexIndex3}, 
          {amount: amountIn, amountMin: zeroBN, path:[WXDAI.address, GNO.address] , dexIndex: dexIndex1}, 
          {amount: amountIn, amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
          impersonated.address,
          impersonated.address
          )
      ).to.be.revertedWith("InvalidTargetPath()")

      await expect(
        zap.connect(owner).setSupportedDEX(dexIndex3, 'dex3', dex3Router.address, dex3Factory.address, overrides)
      ).to.be.revertedWith('DexIndexAlreadyUsed()')
      await expect(
        zap.connect(owner).setSupportedDEX(BigNumber.from(6), 'dex3', dex3Router.address, dex2Factory.address, overrides)
      ).to.be.revertedWith('InvalidRouterOrFactory()')

      await expect(
        zap.connect(owner).setNewAffiliateSplit(BigNumber.from(10001))
      ).to.be.revertedWith("ForbiddenValue()")
    })

    it("revert on zapIn - uniswap", async function () {

      await expect(
        zap.connect(impersonated).zapIn(
          {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: uniswapV2Index4}, 
          {amount: amountIn, amountMin: zeroBN, path:[COW.address, GNO.address] , dexIndex: uniswapV2Index4}, 
          {amount: amountIn, amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
          impersonated.address,
          impersonated.address, 
          true
          )
      ).to.be.revertedWith("InvalidStartPath()")

      await expect(
      zap.connect(impersonated).zapOut(
        {amountLpFrom: zeroBN, amountTokenToMin: zeroBN, dexIndex: uniswapV2Index4}, 
        {amount: amountIn, amountMin: zeroBN, path:[WXDAI.address, GNO.address] , dexIndex: uniswapV2Index4}, 
        {amount: amountIn, amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
        impersonated.address,
        impersonated.address
        )
    ).to.be.revertedWith("InvalidTargetPath()")
    })
  })

  describe("Supported DEXs", function () {
    it("set supported dexs", async function () {
      expect((await zap.connect(impersonated).supportedDEXs(dexIndex1)).factory
      ).to.be.equal(dxswapFactory.address)
      expect((await zap.connect(impersonated).supportedDEXs(dexIndex2)).router
      ).to.be.equal(dex2Router.address)
      expect((await zap.connect(impersonated).supportedDEXs(dexIndex3)).name
      ).to.be.equal('dex3')
    })
  })

  describe("Protocol fee", function () {
    it("initial addresses", async function () {
      expect((await zap.feeToSetter())).to.eq(FEE_TO_SETTER)
      expect(await zap.protocolFee()).to.eq(50)
    })
    it("revert if caller is not owner", async function () {
      await expect(zap.connect(impersonated).setFeeToSetter(user.address, overrides))
      .to.be.revertedWith("OnlyFeeSetter()")
      await expect(zap.connect(impersonated).setProtocolFee(100, overrides))
      .to.be.revertedWith("OnlyFeeSetter()")
    })
    it("revert if invalid fee value", async function () {
      await expect(zap.connect(feeSetter).setProtocolFee(BigNumber.from(11000), overrides))
      .to.be.revertedWith("ForbiddenValue()")
    })
    it("withdraw ownable", async function () {
      await expect(zap.connect(impersonated).withdrawTokens([]))
      .to.be.revertedWith("OnlyOwner()")
      await expect(zap.connect(owner).withdrawTokens([]))
      .to.not.be.reverted;
    })
    it("native asset fees withdrawal", async function () {
      // load the contract with 100 ETH to pretend we have fees to collect
      await network.provider.send("hardhat_setBalance", [zap.address, "0x56bc75e2d63100000"])

      let nativeCurrencyAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      await expect(zap.connect(owner).withdrawTokens([nativeCurrencyAddress]))
      .to.not.be.reverted
    })
    it("token fees withdrawal", async function () {
      await expect(zap.connect(owner).withdrawTokens([WXDAI.address]))
      .to.not.be.reverted
    })
    it("set protocol fee", async function () {
      await zap.connect(feeSetter).setProtocolFee(BigNumber.from(100), overrides)
      await zap.connect(feeSetter).setFeeToSetter(user.address, overrides)
      await zap.connect(user).setFeeToSetter(feeReceiver.address, overrides)

      expect(await zap.protocolFee()).to.eq(100)
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
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        randomSigner.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
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
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
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
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address] , dexIndex: dexIndex1}, 
        impersonated.address, 
        randomSigner.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const zapTokenBalance = await DXD.balanceOf(zap.address)
      const zapFeeTaken = (totalAmount.mul(protocolFeeForZap)).div(BigNumber.from(10000))
      expect(zapTokenBalance).to.be.eq(zapFeeTaken)
      const affliateBalance = await zap.affiliateBalance(randomSigner.address, DXD.address)
      const affliateTaken = (zapFeeTaken.mul(affliateSplit)).div(BigNumber.from(10000))
      expect(affliateBalance).to.be.eq(affliateTaken)
    })

    it("zap in protocol fee on & address is not whitelisted - uniswap v2", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const protocolFeeForZap = await zap.protocolFee()
      expect(protocolFeeForZap).to.be.above(0)

      // unlist user to check if protocol fee was taken
      await zap.setFeeWhitelist(impersonated.address, false)
      expect(await zap.feeWhitelist(impersonated.address)).to.eq(false)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: uniswapV2Index4}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address] , dexIndex: uniswapV2Index4}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
        impersonated.address, 
        randomSigner.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const zapTokenBalance = await WXDAI.balanceOf(zap.address)
      const zapFeeTaken = (totalAmount.mul(protocolFeeForZap)).div(BigNumber.from(10000))
      expect(zapTokenBalance).to.be.eq(zapFeeTaken)
    })
    
    it("zap in with protocl fee on & address whitelisted - uniswap v2", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const protocolFeeForZap = await zap.protocolFee()
      expect(protocolFeeForZap).to.be.above(0)
      await zap.setFeeWhitelist(impersonated.address, true)
      expect(await zap.feeWhitelist(impersonated.address)).to.eq(true)

      let zapTokenBalanceInit = await WXDAI.balanceOf(zap.address)
      expect(zapTokenBalanceInit).to.be.eq(0)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: uniswapV2Index4},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address] , dexIndex: uniswapV2Index4}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      let zapTokenBalance = await WXDAI.balanceOf(zap.address)
      expect(zapTokenBalance).to.be.eq(0)   
    })

    it("zap in protocol fee on & address is not whitelisted & affiliate on - uniswap v2", async function () {
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
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: uniswapV2Index4},
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address] , dexIndex: uniswapV2Index4}, 
        impersonated.address, 
        randomSigner.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const zapTokenBalance = await WXDAI.balanceOf(zap.address)
      const zapFeeTaken = (totalAmount.mul(protocolFeeForZap)).div(BigNumber.from(10000))
      expect(zapTokenBalance).to.be.eq(zapFeeTaken)
      const affliateBalance = await zap.affiliateBalance(randomSigner.address, WXDAI.address)
      const affliateTaken = (zapFeeTaken.mul(affliateSplit)).div(BigNumber.from(10000))
      expect(affliateBalance).to.be.eq(affliateTaken)
    })

    it("native asset affiliate fees withdrawal", async function () {
      // load the contract with 100 ETH to pretend we have fees to collect
      await network.provider.send("hardhat_setBalance", [zap.address, "0x56bc75e2d63100000"])

      let nativeCurrencyAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      await expect(zap.connect(owner).affilliateWithdraw([nativeCurrencyAddress]))
      .to.not.be.reverted
    })
    it("token affiliate fees withdrawal", async function () {
      await expect(zap.connect(owner).affilliateWithdraw([WXDAI.address]))
      .to.not.be.reverted
    })
  })
  
  describe("Zap In", function () {
    it("zap in dxd token to dxd/weth", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await dxdWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      const lpBalance = await dxdWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,DXD.address, totalAmount, dxdWeth.address, lpBought)
    })

    it("zap in dxd token to gno/xdai", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await gnoXdai.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address, GNO.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WXDAI.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      const lpBalance = await gnoXdai.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,DXD.address, totalAmount, gnoXdai.address, lpBought)
    })

    it("zap in wxdai token to cow/weth", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      const lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,WXDAI.address, totalAmount, cowWeth.address, lpBought)
    })

    it("zap in native currency (xdai) token to cow/weth", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[AddressZero, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: totalAmount, gasLimit: 9999999}
      )
      
      // @todo: this value should also be asserted
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      const lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      const nativeCurrencyBalance = await impersonated.getBalance()
      
      expect(lpBought).to.be.above(0)
      expect(nativeCurrencyBalanceInit).to.be.above(nativeCurrencyBalance)

      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,AddressZero, totalAmount, cowWeth.address, lpBought)
    })

    it("zap in wxdai token to wxdai/weth - uniswap v2", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await wxdaiWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: uniswapV2Index4},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address] , dexIndex: uniswapV2Index4}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      const lpBalance = await wxdaiWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,WXDAI.address, totalAmount, wxdaiWeth.address, lpBought)
    })
  })
  
  describe("Zap Out", function () {
    it("zap in dxd token to dxd/weth and zap out to wxdai", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await dxdWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WETH.address], dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address] , dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      let lpBalance = await dxdWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,DXD.address, totalAmount, dxdWeth.address, lpBought)
      
      const tokenOutBalanceInit = await WXDAI.balanceOf(impersonated.address) 

      await dxdWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: dexIndex1},
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [DXD.address, WXDAI.address] },
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [WETH.address, WXDAI.address] },
        impersonated.address,
        impersonated.address,
        overrides
      )
      
      lpBalance = await dxdWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)

      const tokenOutBalance = await WXDAI.balanceOf(impersonated.address) 

      expect(tokenOutBalance).to.be.above(tokenOutBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address,dxdWeth.address, lpBought, WXDAI.address, tokenOutBalance.sub(tokenOutBalanceInit))

    })

    it("zap in dxd token to gno/wxdai and zap out to wxdai", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await gnoXdai.balanceOf(impersonated.address)
      const tokenInBalanceInit = await DXD.balanceOf(impersonated.address)
      
      await DXD.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[DXD.address, GNO.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [DXD.address, WXDAI.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await DXD.balanceOf(impersonated.address)      
      let lpBalance = await gnoXdai.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,DXD.address, totalAmount, gnoXdai.address, lpBought)

      const tokenOutBalanceInit = await WXDAI.balanceOf(impersonated.address) 

      await gnoXdai.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: dexIndex1},
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [WXDAI.address] },
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [GNO.address, WXDAI.address] },
        impersonated.address,
        impersonated.address,
        overrides
      )
      
      lpBalance = await gnoXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)

      const tokenOutBalance = await WXDAI.balanceOf(impersonated.address) 

      expect(tokenOutBalance).to.be.above(tokenOutBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address,gnoXdai.address, lpBought, WXDAI.address, tokenOutBalance.sub(tokenOutBalanceInit))
    })

    it("zap in wxdai token to cow/weth and zap out to native currency", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      let lpBalance = await cowWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,WXDAI.address, totalAmount, cowWeth.address, lpBought)


      const nativeCurrencyBalanceBeforeZapOut = await impersonated.getBalance()

      await cowWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: dexIndex1},
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [COW.address, WETH.address, AddressZero] },
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [WETH.address, AddressZero] },
        impersonated.address,
        impersonated.address,
        overrides
      )
      
      const { ethSpendForTx, amountTo: eventAmountTo} = await getTxData(txZapOut, "ZapOut")
      
      const nativeCurrencyBalanceAfterZapOut = await impersonated.getBalance()   
      expect(nativeCurrencyBalanceAfterZapOut).to.be.above(nativeCurrencyBalanceBeforeZapOut)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address,cowWeth.address, lpBought, AddressZero, eventAmountTo)
    })

    it("zap in native currency (xdai) token to cow/weth and zap out to natice currency", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[AddressZero, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
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
      .withArgs(impersonated.address, impersonated.address,AddressZero, totalAmount, cowWeth.address, lpBought)

      const nativeCurrencyBalanceBeforeZapOut = await impersonated.getBalance()

      await cowWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: dexIndex1},
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [COW.address, WETH.address, AddressZero] },
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [WETH.address, AddressZero] },
        impersonated.address,
        impersonated.address,
        overrides
      )
      
      const { ethSpendForTx, amountTo: eventAmountTo} = await getTxData(txZapOut, "ZapOut")

      
      const nativeCurrencyBalanceAfterZapOut = await impersonated.getBalance()   
      expect(nativeCurrencyBalanceAfterZapOut).to.be.above(nativeCurrencyBalanceBeforeZapOut)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address,cowWeth.address, lpBought, AddressZero, eventAmountTo)
    })

    it("zap in native currency (xdai) token to cow/weth and zap out to wrapped natice currency", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex1},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[AddressZero, WETH.address, COW.address] , dexIndex: dexIndex1}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [AddressZero, WETH.address], dexIndex: dexIndex1}, 
        impersonated.address, 
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
      .withArgs(impersonated.address, impersonated.address,AddressZero, totalAmount, cowWeth.address, lpBought)

      const tokenOutBalanceBeforeZapOut = await WXDAI.balanceOf(impersonated.address)
      
      await cowWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: dexIndex1},
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [COW.address, WETH.address, WXDAI.address] },
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [WETH.address, WXDAI.address] },
        impersonated.address,
        impersonated.address,
        overrides
        )
        
      const { ethSpendForTx, amountTo: eventAmountTo} = await getTxData(txZapOut, "ZapOut")
        
        
      const tokenOutBalanceAfterZapOut = await WXDAI.balanceOf(impersonated.address)
      const nativeCurrencyBalanceAfterZapOut = await impersonated.getBalance()   

      expect(nativeCurrencyBalanceAfterZapOut).to.be.below(nativeCurrencyBalanceInit)
      expect(eventAmountTo).to.be.eq(tokenOutBalanceAfterZapOut.sub(tokenOutBalanceBeforeZapOut))
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address,cowWeth.address, lpBought, WXDAI.address, eventAmountTo)
    })
  })

  describe("Zap with different DEXs", function () {
    it("zap in wxdai token to wxdai/weth and zap out to wxdai - uniswap v2", async function () {
      const totalAmount = ethers.utils.parseEther("1")
      const lpBalanceInit = await wxdaiWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: uniswapV2Index4},
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: uniswapV2Index4}, 
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[WXDAI.address] , dexIndex: uniswapV2Index4}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      let lpBalance = await wxdaiWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)
      
      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address, WXDAI.address, totalAmount, wxdaiWeth.address, lpBought)
      
      const tokenOutBalanceInit = await WXDAI.balanceOf(impersonated.address) 

      await wxdaiWeth.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: uniswapV2Index4},
        {amount: zeroBN, amountMin: zeroBN, path: [WXDAI.address], dexIndex: uniswapV2Index4 },
        {amount: zeroBN, amountMin: zeroBN, path: [WETH.address, WXDAI.address], dexIndex: uniswapV2Index4 },
        impersonated.address,
        impersonated.address,
        overrides
      )
      
      lpBalance = await wxdaiWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)

      const tokenOutBalance = await WXDAI.balanceOf(impersonated.address) 

      expect(tokenOutBalance).to.be.above(tokenOutBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address, wxdaiWeth.address, lpBought, WXDAI.address, tokenOutBalance.sub(tokenOutBalanceInit))

    })

    it("zap in dxd token to dxd/weth", async function () {
      const amountA = ethers.utils.parseEther("1")
      const amountB = ethers.utils.parseEther("13")
      const totalAmount = amountA.add(amountB)
      const lpBalanceInit = await wethGnoDex3.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)
      
      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex3},
        {amount: amountA, amountMin: zeroBN, path:[WXDAI.address, WETH.address] , dexIndex: dexIndex2}, 
        {amount: amountB, amountMin: zeroBN, path: [WXDAI.address, GNO.address], dexIndex: dexIndex1}, 
        impersonated.address, 
        impersonated.address, 
        true,
        {value: zeroBN, gasLimit: 9999999}
      )
      
      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)      
      let lpBalance = await wethGnoDex3.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)

      const { amountTo } = await getTxData(txZapIn, "ZapIn")
      
      expect(lpBought).to.be.above(0)
      expect(lpBought).to.be.eq(amountTo)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,WXDAI.address, totalAmount, wethGnoDex3.address, lpBought)
    })

    it("zap in wxdai token to cow/weth and zap out to cow", async function () {
      const amountA = ethers.utils.parseEther("1")
      const amountB = ethers.utils.parseEther("13")
      const totalAmount = amountA.add(amountB)
      const lpBalanceInit = await wethGnoDex3.balanceOf(impersonated.address)
      const tokenInBalanceInit = await WXDAI.balanceOf(impersonated.address)

      await WXDAI.connect(impersonated).approve(zap.address, totalAmount)
      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex3},
        {amount: amountA, amountMin: zeroBN, path:[WXDAI.address, WETH.address] , dexIndex: dexIndex2},
        {amount: amountB, amountMin: zeroBN, path: [WXDAI.address, GNO.address], dexIndex: dexIndex1},
        impersonated.address,
        impersonated.address,
        true,
        {value: zeroBN, gasLimit: 9999999}
      )

      const tokenInBalance = await WXDAI.balanceOf(impersonated.address)
      let lpBalance = await wethGnoDex3.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)

      const { amountTo } = await getTxData(txZapIn, "ZapIn")

      expect(lpBought).to.be.above(0)
      expect(lpBought).to.be.eq(amountTo)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)
      
      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address,WXDAI.address, totalAmount, wethGnoDex3.address, lpBought)


      const tokenBalanceBeforeZapOut = await COW.balanceOf(impersonated.address)

      await wethGnoDex3.connect(impersonated).approve(zap.address, lpBought)
      const txZapOut = await zap.connect(impersonated).zapOut(
        {amountLpFrom: lpBought, amountTokenToMin: zeroBN, dexIndex: dexIndex3},
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex1, path: [WETH.address, COW.address] },
        {amount: zeroBN, amountMin: zeroBN, dexIndex: dexIndex3, path: [GNO.address, COW.address] },
        impersonated.address,
        impersonated.address,
        overrides
      )
      
      const { amountTo: eventAmountTo} = await getTxData(txZapOut, "ZapOut")

      
      const tokenBalanceAfterZapOut = await COW.balanceOf(impersonated.address)
      expect(tokenBalanceAfterZapOut).to.be.above(tokenBalanceBeforeZapOut)
      
      lpBalance = await wethGnoDex3.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(lpBalanceInit)
      await expect(txZapOut).to.emit(zap, "ZapOut")
      .withArgs(impersonated.address, impersonated.address,wethGnoDex3.address, lpBought, COW.address, eventAmountTo)
    })
  })

  describe("tether token", function () {
    it("zap in usdt token to usdt/weth", async function () {
      // Send some USDT to the user to start with
      await USDT.connect(tetherHolder).transfer(impersonated.address, BigNumber.from("10000000000"))

      const totalAmount = BigNumber.from("10000000000")
      const lpBalanceInit = await usdtWethDex2.balanceOf(impersonated.address)
      const tokenInBalanceInit = await USDT.balanceOf(impersonated.address)

      await USDT.connect(impersonated).approve(zap.address, 0)
      await USDT.connect(impersonated).approve(zap.address, totalAmount)

      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex2},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[USDT.address], dexIndex: dexIndex2},
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [USDT.address, WETH.address], dexIndex: dexIndex2},
        impersonated.address,
        impersonated.address,
        false,
        {value: zeroBN, gasLimit: 9999999}
      )

      const tokenInBalance = await USDT.balanceOf(impersonated.address)
      const lpBalance = await usdtWethDex2.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)

      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)

      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address, USDT.address, totalAmount, usdtWeth.address, lpBought)
    })

    it("zap in usdt token to wxdai/weth", async function () {
      // Send some USDT to the user to start with
      await USDT.connect(tetherHolder).transfer(impersonated.address, BigNumber.from("10000000000"))

      const totalAmount = BigNumber.from("10000000000")
      const lpBalanceInit = await wxdaiWeth.balanceOf(impersonated.address)
      const tokenInBalanceInit = await USDT.balanceOf(impersonated.address)

      await USDT.connect(impersonated).approve(zap.address, 0)
      await USDT.connect(impersonated).approve(zap.address, totalAmount)

      const txZapIn = await zap.connect(impersonated).zapIn(
        {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex2},
        {amount: totalAmount.div(2), amountMin: zeroBN, path:[USDT.address, WETH.address, WXDAI.address] , dexIndex: dexIndex2},
        {amount: totalAmount.div(2), amountMin: zeroBN, path: [USDT.address, WETH.address], dexIndex: dexIndex2},
        impersonated.address,
        impersonated.address,
        false,
        {value: zeroBN, gasLimit: 9999999}
      )

      const tokenInBalance = await USDT.balanceOf(impersonated.address)
      const lpBalance = await wxdaiWeth.balanceOf(impersonated.address)
      const lpBought = lpBalance.sub(lpBalanceInit)

      expect(lpBought).to.be.above(0)
      expect(tokenInBalanceInit).to.be.above(tokenInBalance)

      await expect(txZapIn).to.emit(zap, "ZapIn")
      .withArgs(impersonated.address, impersonated.address, USDT.address, totalAmount, wxdaiWeth.address, lpBought)
    })
  })

  describe("Ownable", function () {
    it("change owner", async function () {
      await expect(zap.connect(impersonated).setOwner(user.address, overrides))
      .to.be.revertedWith("OnlyOwner()")
      await zap.connect(owner).setOwner(user.address, overrides)
      expect(await zap.owner(overrides)).to.be.equal(owner.address)
      await expect(zap.connect(user).acceptOwner(overrides))
      .to.emit(zap, "OwnerSet").withArgs(user.address)
      expect(await zap.owner(overrides)).to.be.equal(user.address)
      
      await expect(zap.connect(owner).setOwner(user.address, overrides))
      .to.be.revertedWith("OnlyOwner()")
      await zap.connect(user).setOwner(owner.address, overrides)
      await expect(zap.connect(owner).acceptOwner(overrides))
      .to.emit(zap, "OwnerSet").withArgs(owner.address)
      expect(await zap.owner(overrides)).to.be.equal(owner.address)
    })
  })

  describe("Stop in emergency", function () {
    it("ownable", async function () {
      await expect(zap.connect(impersonated).toggleContractActive())
      .to.be.revertedWith("OnlyOwner()")
      await expect(zap.connect(owner).toggleContractActive())
      .to.not.be.reverted
    })
    it("toggle contract active", async function () {
      await zap.connect(owner).toggleContractActive()
      expect(await zap.stopped()).to.be.true;
      await zap.connect(owner).toggleContractActive()
      expect(await zap.stopped()).to.be.false;
    })
    it("stop in emergency modifier", async function () {
      await zap.connect(owner).toggleContractActive()
      expect(await zap.stopped()).to.be.true;
      
      await expect(
        zap.connect(impersonated).zapIn(
          {amountAMin: zeroBN, amountBMin: zeroBN, amountLPMin: zeroBN, dexIndex: dexIndex3}, 
          {amount: zeroBN, amountMin: zeroBN, path:[WXDAI.address, GNO.address] , dexIndex: dexIndex1}, 
          {amount: zeroBN, amountMin: zeroBN, path: [WXDAI.address, WETH.address], dexIndex: dexIndex1}, 
          impersonated.address,
          impersonated.address, 
          true
          )
      ).to.be.revertedWith("TemporarilyPaused()")
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

const getTxData = async (tx: ContractTransaction, zapType: string): Promise<{ethSpendForTx: BigNumber; sender: string, tokenFrom: string, amountFrom: BigNumber, tokenTo: string, amountTo: BigNumber}> => {
  const txReceipt = await tx.wait();
  const event = txReceipt.events && txReceipt.events.find(e => e.event === zapType);
  const ethSpendForTx = txReceipt.gasUsed.mul(txReceipt.effectiveGasPrice)
  const sender = event?.args && event?.args["sender"]
  const tokenFrom = event?.args && event?.args[zapType === 'ZapOut' ? "pairFrom" : "tokenFrom"]
  const amountFrom = BigNumber.from( event?.args && event?.args["amountFrom"])
  const tokenTo = event?.args && event?.args[zapType === 'ZapOut' ? "tokenTo" : "pairTo"]
  const amountTo = BigNumber.from( event?.args && event?.args["amountTo"])
  return { ethSpendForTx, sender, tokenFrom, amountFrom, tokenTo, amountTo }
}
