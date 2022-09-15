// @ts-ignore
import { ethers, network, waffle } from "hardhat"
import { expect } from "chai"
import { BigNumber, constants } from "ethers"
import { DXswapPair, DXswapRouter, ERC20, IERC20, WETH9, WXDAI, Zap } from "../typechain"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { dxswapFixture } from "./shared/fixtures"
import { Address } from "hardhat-deploy/types"
import { calculateAmountsOut } from "./shared/utilities"

const amountIn = ethers.utils.parseEther("1")
const { AddressZero, MaxUint256 } = constants

const overrides = {
  gasLimit: 9999999
}

// Using a Round error exception of 0.00000000000001 in ETH Unit, this equals 10000 in WEI unit, same value used as denominator for swap fee calculation 
const ROUND_EXCEPTION = BigNumber.from(10).pow(4)

const USER_ACCOUNT = "0xe716EC63C5673B3a4732D22909b38d779fa47c3F" //dao avatar as example user

describe.only("Zap", function () {
  let zap: Zap
  let dxswapRouter: DXswapRouter

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
  let signer: SignerWithAddress
  let user: SignerWithAddress
  let feeReceiver: SignerWithAddress
  let impersonated: SignerWithAddress
  let feeSetter: SignerWithAddress
  let randomSigner: SignerWithAddress
  let FEE_TO_SETTER: Address

  beforeEach('assign wallets', async function () {
    const signers = await ethers.getSigners()
    signer = signers[0]
    user = signers[1]
    feeReceiver = signers[2]
    randomSigner = signers[3]
  })
  
  beforeEach('deploy fixture', async function () {
    const fixture = await dxswapFixture(signer)
    zap = fixture.zap
    dxswapRouter = fixture.dxswapRouter
    
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

  describe("Revert", function () {
    it("Revert on zapInFromNativeCurrency", async function () {
      let amountOut = await getAmountOut(WXDAI.address, gnoXdai)
      await expect(
        zap.connect(impersonated).zapInFromNativeCurrency(amountOut, 0, [WXDAI.address, GNO.address], [WXDAI.address, WETH.address], {
          value: amountIn,
          gasLimit: 9999999,
        })
      ).to.be.revertedWith("InsufficientSwapMinAmount()")
      
      amountOut = await getAmountOut(WXDAI.address, wethXdai)
      await expect(
        zap.connect(signer).zapInFromNativeCurrency(0, amountOut, [WXDAI.address, GNO.address], [WXDAI.address, WETH.address], {
          value: amountIn,
          gasLimit: 9999999,
        })
      ).to.be.revertedWith("InsufficientSwapMinAmount()")

      await expect(
        zap.connect(impersonated).zapInFromNativeCurrency(0, 0, [WXDAI.address, GNO.address], [WXDAI.address, WETH.address], {
          value: 0,
          gasLimit: 9999999,
        })
      ).to.be.revertedWith("InsufficientTokenInputAmount()")
    })

    it("Revert on zapInFromTokens", async function () {
      await DXD.connect(impersonated).approve(zap.address, ethers.utils.parseEther("100"), overrides)
      let amountOut = ethers.utils.parseEther("99")
      await expect(
        zap.connect(impersonated).zapInFromToken(amountIn, amountOut, 0, [DXD.address, WETH.address], [DXD.address, GNO.address])
        ).to.be.revertedWith("InsufficientSwapMinAmount()")
      await expect(
        zap.connect(impersonated).zapInFromToken(amountIn, 0, amountOut, [DXD.address, WETH.address], [DXD.address, GNO.address])
      ).to.be.revertedWith("InsufficientSwapMinAmount()")
    })

    it("Revert on zapOutToNativeCurrency", async function () {
      const tx = await zap.connect(impersonated).zapInFromNativeCurrency(0, 0, [WXDAI.address, GNO.address], [WXDAI.address, WETH.address], {
        value: amountIn,
        gasLimit: 9999999,
      })

      await expect(tx).to.emit(zap, 'ZapInFromNativeCurrency')
      .withArgs(impersonated.address, amountIn, wethGno.address, await wethGno.balanceOf(impersonated.address))

      await wethGno.connect(impersonated).approve(zap.address, ethers.utils.parseEther("100"))
      
      await expect(
        zap
        .connect(impersonated)
        .zapOutToToken(await wethGno.balanceOf(impersonated.address), ethers.utils.parseEther("100"), [GNO.address, WXDAI.address], [WETH.address, WXDAI.address])
        ).to.be.revertedWith("InsufficientSwapMinAmount()")
    })

    it("Revert if an user tries to use withdraw", async function () {
      await expect(zap.connect(user).withdraw(WXDAI.address)).to.be.revertedWith("OnlyOwner()")
    })

    it("Revert if allowance too low", async function () {
      // zap in 
      await zap.connect(impersonated)
      .zapInFromNativeCurrency(0, 0, [WXDAI.address, SWPR.address], [WXDAI.address], { value: amountIn, gasLimit: 9999999 })

      const lpBalance = await swprXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      
      // zap out
      await expect(
      zap.connect(impersonated)
        .zapOutToNativeCurrency(lpBalance, 0, [WXDAI.address], [SWPR.address, WXDAI.address], overrides)
        ).to.be.reverted
    })

    it("Revert if invalid path", async function () {
      // zap in 
      await expect(
      zap.connect(impersonated)
      .zapInFromNativeCurrency(0, 0, [WXDAI.address, randomSigner.address], [WXDAI.address], { value: amountIn, gasLimit: 9999999 })
      ).to.be.revertedWith("InvalidPair()") 

      // zap in 
      await expect(
      zap.connect(impersonated)
      .zapInFromToken(amountIn, 0, 0, [WXDAI.address, randomSigner.address], [COW.address, WXDAI.address], overrides)
      ).to.be.revertedWith("InvalidStartPath()") 
      
      // zap out 
      await expect(
        zap.connect(impersonated)
        .zapOutToToken(0, 0, [WXDAI.address, randomSigner.address], [WXDAI.address], overrides)
        ).to.be.revertedWith("InvalidTargetPath()")

      // zap out 
      await expect(
        zap.connect(impersonated)
        .zapOutToToken(0, 0, [randomSigner.address, SWPR.address], [WXDAI.address, SWPR.address], overrides)
        ).to.be.revertedWith("InvalidPair()")
    })
  })

  describe("Native Currency", function () {
    it("zap in native currency to swpr/wxdai and zap out to native currency: xdai", async function () {
      const lpBalanceInit = await swprXdai.balanceOf(impersonated.address)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromNativeCurrency(0, 0, [WXDAI.address, SWPR.address], [WXDAI.address], { value: amountIn })
      
      let lpBalance = await swprXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      
      await expect(txZapIn).to.emit(zap, "ZapInFromNativeCurrency")
      .withArgs(impersonated.address, amountIn, swprXdai.address, lpBalance.sub(lpBalanceInit))
      
      const amountFrom = lpBalance
      
      await swprXdai.connect(impersonated).approve(zap.address, amountFrom)
      const nativeCurrencyBalanceBefore = await impersonated.getBalance()
      
      // zap out
      const txZapOut = await zap.connect(impersonated)
      .zapOutToNativeCurrency(amountFrom, 0, [SWPR.address, WXDAI.address], [WXDAI.address], overrides)
      
      lpBalance = await swprXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)
      
      const nativeCurrencyBalanceEnd = await impersonated.getBalance()
      
      expect(nativeCurrencyBalanceEnd).to.be.above(nativeCurrencyBalanceBefore)
      await expect(txZapOut).to.emit(zap, "ZapOutToNativeCurrency")
    })

    it("zap in native currency to cow/weth and zap out to wrapped native currency: wxdai", async function () {
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      const nativeCurrencyWrapperBalanceInit = await WXDAI.balanceOf(impersonated.address)

      let lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromNativeCurrency(0, 0, [WXDAI.address, COW.address], [WXDAI.address, WETH.address], { value: amountIn })
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      
      await expect(txZapIn).to.emit(zap, "ZapInFromNativeCurrency")
      .withArgs(impersonated.address, amountIn, cowWeth.address, lpBalance)

      const nativeCurrencyBalanceAfter = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(nativeCurrencyBalanceAfter)
      
      const amountFrom = lpBalance  
      await cowWeth.connect(impersonated).approve(zap.address, amountFrom)
      
      // zap out
      const txZapOut = await zap.connect(impersonated)
      .zapOutToToken(amountFrom, 0, [COW.address, WXDAI.address], [WETH.address, WXDAI.address], overrides)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)
      
      const nativeCurrencyBalanceEnd = await impersonated.getBalance()
      expect(nativeCurrencyBalanceEnd).to.be.lte(nativeCurrencyBalanceAfter)
      
      const nativeCurrencyWrapperBalance = (await WXDAI.balanceOf(impersonated.address)).sub(nativeCurrencyWrapperBalanceInit)
      expect(nativeCurrencyWrapperBalance).to.be.above(0)

      await expect(txZapOut).to.emit(zap, "ZapOutToToken")
      .withArgs(impersonated.address, cowWeth.address, amountFrom, WXDAI.address, nativeCurrencyWrapperBalance)
    })
  })

  describe("Token", function () {
    it("zap in dxd token to dxd/weth and zap out to native currency: xdai", async function () {
      const lpBalanceInit = await dxdWeth.balanceOf(impersonated.address)
      await dxswapRouter.connect(impersonated).swapExactETHForTokens(0,[WXDAI.address, DXD.address], impersonated.address, MaxUint256, 
        {value: ethers.utils.parseEther("1"),   
        gasLimit: 9999999,
      })

      const amountFromZapIn = amountIn
      await DXD.connect(impersonated).approve(zap.address, amountFromZapIn)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromToken(amountFromZapIn, 0, 0, [DXD.address], [DXD.address, WETH.address], overrides)
      
      let lpBalance = await dxdWeth.balanceOf(impersonated.address)
      const amountToZapIn = lpBalance.sub(lpBalanceInit)
      expect(lpBalance).to.be.above(0)
      expect(amountToZapIn).to.be.above(0)
      
      await expect(txZapIn).to.emit(zap, "ZapInFromToken")
      .withArgs(impersonated.address, DXD.address, amountFromZapIn, dxdWeth.address, amountToZapIn)
      
      const amountFromZapOut = lpBalance
      await dxdWeth.connect(impersonated).approve(zap.address, amountFromZapOut)
      
      const nativeCurrencyBalanceBefore = await impersonated.getBalance()
      
      // zap out
      const txZapOut = await zap.connect(impersonated)
      // note that path dxd-weth-wxdai works as well
      .zapOutToNativeCurrency(amountFromZapOut, 0, [DXD.address, WXDAI.address], [WETH.address, WXDAI.address], overrides)
      
      const nativeCurrencyBalanceEnd = await impersonated.getBalance()
      
      lpBalance = await dxdWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)

      expect(nativeCurrencyBalanceEnd).to.be.above(nativeCurrencyBalanceBefore)
      await expect(txZapOut).to.emit(zap, "ZapOutToNativeCurrency")
    })

    it("zap in token to gno/wxdai and zap out to native currency: xdai", async function () {
      const lpBalanceInit = await gnoXdai.balanceOf(impersonated.address)
      await dxswapRouter.connect(impersonated).swapExactETHForTokens(0,[WXDAI.address, DXD.address], impersonated.address, MaxUint256, 
        {value: ethers.utils.parseEther("1"),   
        gasLimit: 9999999,
      })

      const amountFromZapIn = amountIn
      await DXD.connect(impersonated).approve(zap.address, amountFromZapIn)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromToken(amountFromZapIn, 0, 0, [DXD.address, GNO.address], [DXD.address, WXDAI.address], overrides)
      
      let lpBalance = await gnoXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      const amountToZapIn = lpBalance.sub(lpBalanceInit)
      
      await expect(txZapIn).to.emit(zap, "ZapInFromToken")
      .withArgs(impersonated.address, DXD.address, amountFromZapIn, gnoXdai.address, amountToZapIn)
      
      const amountFromZapOut = lpBalance
      await gnoXdai.connect(impersonated).approve(zap.address, amountFromZapOut)
      
      const nativeCurrencyBalanceBefore = await impersonated.getBalance()
      
      // zap out
      const txZapOut = await zap.connect(impersonated)
      .zapOutToNativeCurrency(amountFromZapOut, 0, [WXDAI.address], [GNO.address, WXDAI.address], overrides)
      
      const nativeCurrencyBalanceEnd = await impersonated.getBalance()
      
      lpBalance = await gnoXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)

      expect(nativeCurrencyBalanceEnd).to.be.above(nativeCurrencyBalanceBefore)
      await expect(txZapOut).to.emit(zap, "ZapOutToNativeCurrency")
    })

    it("zap in dxd token to gno/weth and zap out to wrapped native currency token: wxdai", async function () {
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      const lpBalanceInit = await wethGno.balanceOf(impersonated.address)
      await dxswapRouter.connect(impersonated).swapExactETHForTokens(0,[WXDAI.address, DXD.address], impersonated.address, MaxUint256, 
        {value: ethers.utils.parseEther("1"),   
        gasLimit: 9999999,
      })
      let amountFrom = await DXD.balanceOf(impersonated.address)

      await DXD.connect(impersonated).approve(zap.address, amountFrom)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromToken(amountFrom, 0, 0, [DXD.address, GNO.address], [DXD.address, WETH.address], overrides)
      
      let lpBalance = await wethGno.balanceOf(impersonated.address)
      await expect(txZapIn).to.emit(zap, "ZapInFromToken")
      .withArgs(impersonated.address, DXD.address, amountFrom, wethGno.address, lpBalance.sub(lpBalanceInit))
      
      const nativeCurrencyBalanceAfterZapIn = await impersonated.getBalance()
      expect(nativeCurrencyBalanceAfterZapIn).to.be.below(nativeCurrencyBalanceInit)
      
      lpBalance = await wethGno.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      amountFrom = lpBalance
      const nativeCurrencyWrapperBalanceBefore = await WXDAI.balanceOf(impersonated.address)
      
      await wethGno.connect(impersonated).approve(zap.address, amountFrom)
      
      // zap out
      const txZapOut = await zap.connect(impersonated)
      .zapOutToToken(amountFrom, 0, [GNO.address, WXDAI.address], [WETH.address, WXDAI.address], overrides)
      
      lpBalance = await wethGno.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)
      
      // check if wrapped token wasnt swapped to native currency
      const nativeCurrencyBalanceEnd = await impersonated.getBalance()
      expect(nativeCurrencyBalanceEnd).to.be.lte(nativeCurrencyBalanceAfterZapIn)
      
      const nativeCurrencyWrapperBalanceAfter = await WXDAI.balanceOf(impersonated.address)
      const nativeCurrencyWrapperBalance = nativeCurrencyWrapperBalanceAfter.sub(nativeCurrencyWrapperBalanceBefore)
      expect(nativeCurrencyWrapperBalance).to.be.above(0)
      
      await expect(txZapOut).to.emit(zap, "ZapOutToToken")
      .withArgs(impersonated.address, wethGno.address, amountFrom, WXDAI.address, nativeCurrencyWrapperBalance)
    })

    it("zap in wxdai token to cow/weth and zap out to swpr in a few swaps", async function () {
      const nativeCurrencyBalanceInit = await impersonated.getBalance()
      expect(nativeCurrencyBalanceInit).to.be.above(0)
      const lpBalanceInit = await cowWeth.balanceOf(impersonated.address)
      const amountFrom = await WXDAI.balanceOf(impersonated.address)

      await WXDAI.connect(impersonated).approve(zap.address, amountFrom)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromToken(amountFrom, 0, 0, [WXDAI.address, WETH.address, COW.address], [WXDAI.address, WETH.address], overrides)
      
      let lpBalance = await cowWeth.balanceOf(impersonated.address)
      await expect(txZapIn).to.emit(zap, "ZapInFromToken")
      .withArgs(impersonated.address, WXDAI.address, amountFrom, cowWeth.address, lpBalance.sub(lpBalanceInit))
      
      const nativeCurrencyBalanceAfter = await impersonated.getBalance()
      expect(nativeCurrencyBalanceAfter).to.be.below(nativeCurrencyBalanceInit)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      const amoutFrom = lpBalance
      const tokenOutBalanceBefore = await SWPR.balanceOf(impersonated.address)
      
      await cowWeth.connect(impersonated).approve(zap.address, amoutFrom)
      
      // zap out
      const txZapOut = await zap.connect(impersonated)
      .zapOutToToken(amoutFrom, 0, [COW.address, WETH.address, WXDAI.address, SWPR.address], [WETH.address, WXDAI.address, SWPR.address], overrides)
      
      lpBalance = await cowWeth.balanceOf(impersonated.address)
      expect(lpBalance).to.be.eq(0)
      
      const nativeCurrencyBalanceEnd = await impersonated.getBalance()
      expect(nativeCurrencyBalanceEnd).to.be.lte(nativeCurrencyBalanceAfter)
      
      const tokenOutBalanceAfter = await SWPR.balanceOf(impersonated.address)
      const tokenOutBalance = tokenOutBalanceAfter.sub(tokenOutBalanceBefore)
      expect(tokenOutBalance).to.be.above(0)
      
      await expect(txZapOut).to.emit(zap, "ZapOutToToken")
      .withArgs(impersonated.address, cowWeth.address, amoutFrom, SWPR.address, tokenOutBalance)
      
      const amountFromEnd = await WXDAI.balanceOf(impersonated.address)
      expect(amountFromEnd).to.be.eq(0)
    })
  })

  describe("Zap protocol fee on", function () {
    beforeEach('set fee receiver', async function () {
      await zap.connect(feeSetter).setFeeTo(feeReceiver.address, overrides)
    })
    it("zap in token to gno/wxdai and zap out to native currency: xdai", async function () {
      const amountFromZapIn =  ethers.utils.parseEther("1")
      const lpBalanceInit = await gnoXdai.balanceOf(impersonated.address)      
      await dxswapRouter.connect(impersonated).swapExactETHForTokens(0,[WXDAI.address, DXD.address], impersonated.address, MaxUint256, 
        {value: ethers.utils.parseEther("5"),   
        gasLimit: 9999999,
      })
      const balanceUser = await DXD.balanceOf(impersonated.address)
      
      const fee = BigNumber.from(await zap.protocolFee())
      const {amountInProtocolFee, amountInZap } = calculateAmountsOut(balanceUser, fee)
      
      await DXD.connect(impersonated).approve(zap.address, balanceUser)
      
      let feeReceiverBalance = await DXD.balanceOf(feeReceiver.address)
      expect(feeReceiverBalance).to.be.eq(0)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromToken(balanceUser, 0, 0, [DXD.address, GNO.address], [DXD.address, WXDAI.address], overrides)
    
      feeReceiverBalance = await DXD.balanceOf(feeReceiver.address)
      expect(feeReceiverBalance).to.be.eq(amountInProtocolFee).to.be.above(0)
      
      let lpBalance = await gnoXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      const amountToZapIn = lpBalance.sub(lpBalanceInit)
      
      await expect(txZapIn).to.emit(zap, "ZapInFromToken")
      .withArgs(impersonated.address, DXD.address, balanceUser, gnoXdai.address, amountToZapIn)
    })

    it("zap in native currency to swpr/wxdai and zap out to native currency: xdai", async function () {
      const lpBalanceInit = await swprXdai.balanceOf(impersonated.address)
      const feeReceiverNativeCurrencyBalanceInit = await feeReceiver.getBalance()
      const fee = BigNumber.from(await zap.protocolFee())
      const {amountInProtocolFee, amountInZap } = calculateAmountsOut(amountIn, fee)
      
      // zap in 
      const txZapIn = await zap.connect(impersonated)
      .zapInFromNativeCurrency(0, 0, [WXDAI.address, SWPR.address], [WXDAI.address], { value: amountIn })
      
      let lpBalance = await swprXdai.balanceOf(impersonated.address)
      expect(lpBalance).to.be.above(0)
      
      await expect(txZapIn).to.emit(zap, "ZapInFromNativeCurrency")
      .withArgs(impersonated.address, amountIn, swprXdai.address, lpBalance.sub(lpBalanceInit))
      
      const feeReceiverNativeCurrencyBalanceAfter = await feeReceiver.getBalance()
      expect(feeReceiverNativeCurrencyBalanceAfter.sub(feeReceiverNativeCurrencyBalanceInit)).to.be.eq(amountInProtocolFee)
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
      .to.be.revertedWith("ForbiddenFeeValue()")
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
