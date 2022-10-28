import { expandTo18Decimals } from './utilities'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { DXswapFactory, DXswapFactory__factory, DXswapPair, DXswapPair__factory, DXswapRouter, DXswapRouter__factory, ERC20, ERC20__factory, TokenERC20__factory, WETH9, WETH9__factory, WXDAI, WXDAI__factory, Zap, Zap__factory } from '../../typechain'

interface DXswapFixture {
  zap: Zap
  dxswapRouter: DXswapRouter
  dxswapFactory: DXswapFactory
    
  WETH: WETH9
  WXDAI: WXDAI
  GNO: ERC20
  DXD: ERC20
  COW: ERC20
  SWPR: ERC20

  wethXdai: DXswapPair
  swprXdai: DXswapPair
  wethGno: DXswapPair
  gnoXdai: DXswapPair
  dxdWeth: DXswapPair
  cowWeth: DXswapPair
  }

  

export async function fixtureLocalDeploy(wallet: SignerWithAddress): Promise<DXswapFixture> {
  const tokenAmount = expandTo18Decimals(10)
  const overrides = {
    gasLimit: 9999999
  }

  // deploy tokens
  const SWPR = await new TokenERC20__factory(wallet).deploy(expandTo18Decimals(10000))
  const GNO = await new TokenERC20__factory(wallet).deploy(expandTo18Decimals(10000))
  const DXD = await new TokenERC20__factory(wallet).deploy(expandTo18Decimals(10000))
  const COW = await new TokenERC20__factory(wallet).deploy(expandTo18Decimals(10000))

  const WETH = await new WETH9__factory(wallet).deploy()
  const WXDAI = await new WXDAI__factory(wallet).deploy()


  // deploy DXswapFactory
  const dxswapFactory = await new DXswapFactory__factory(wallet).deploy(wallet.address)

  // deploy router
  // deployed on Gnosis Chain so wrapped native currency is WXDAI
  const dxswapRouter = await new DXswapRouter__factory(wallet).deploy(dxswapFactory.address, WXDAI.address)

  // initialize DXswapPair factory
  const dxSwapPair_factory = await new DXswapPair__factory(wallet).deploy()

  // create pairs
  await dxswapFactory.createPair(WETH.address, WXDAI.address)
  let pairAddress = await dxswapFactory.getPair(WETH.address, WXDAI.address)
  const wethXdai = dxSwapPair_factory.attach(pairAddress)
  await WETH.deposit({ ...overrides, value: expandTo18Decimals(200) })
  await WETH.transfer(wethXdai.address, tokenAmount, overrides)
  await WXDAI.deposit({ ...overrides, value: expandTo18Decimals(200) })
  await WXDAI.transfer(wethXdai.address, tokenAmount, overrides)
  await wethXdai.mint(wallet.address, overrides)
  
  await dxswapFactory.createPair(WETH.address, GNO.address)
  pairAddress = await dxswapFactory.getPair(WETH.address, GNO.address)
  const wethGno = dxSwapPair_factory.attach(pairAddress)
  await WETH.transfer(wethGno.address, tokenAmount, overrides)
  await GNO.transfer(wethGno.address, tokenAmount, overrides)
  await wethGno.mint(wallet.address, overrides)

  
  await dxswapFactory.createPair(WXDAI.address, GNO.address)
  pairAddress = await dxswapFactory.getPair(WXDAI.address, GNO.address)
  const gnoXdai = dxSwapPair_factory.attach(pairAddress)
  await GNO.transfer(gnoXdai.address, tokenAmount, overrides)
  await WXDAI.transfer(gnoXdai.address, tokenAmount, overrides)
  await gnoXdai.mint(wallet.address, overrides)
  
  await dxswapFactory.createPair(SWPR.address, WXDAI.address)
  pairAddress = await dxswapFactory.getPair(SWPR.address, WXDAI.address)
  const swprXdai = dxSwapPair_factory.attach(pairAddress)
  await SWPR.transfer(swprXdai.address, tokenAmount, overrides)
  await WXDAI.transfer(swprXdai.address, tokenAmount, overrides)
  await swprXdai.mint(wallet.address, overrides)
  
  await dxswapFactory.createPair(DXD.address, WETH.address)
  pairAddress = await dxswapFactory.getPair(DXD.address, WETH.address)
  const dxdWeth = dxSwapPair_factory.attach(pairAddress)
  await DXD.transfer(dxdWeth.address, tokenAmount, overrides)
  await WETH.transfer(dxdWeth.address, tokenAmount, overrides)
  await dxdWeth.mint(wallet.address, overrides)

  await dxswapFactory.createPair(COW.address, WETH.address)
  pairAddress = await dxswapFactory.getPair(COW.address, WETH.address)
  const cowWeth = dxSwapPair_factory.attach(pairAddress)
  await COW.transfer(cowWeth.address, tokenAmount, overrides)
  await WETH.transfer(cowWeth.address, tokenAmount, overrides)
  await cowWeth.mint(wallet.address, overrides)
  
  // deploy Relayer and TradeRelayer
  const zap = await new Zap__factory(wallet).deploy(wallet.address, wallet.address, WXDAI.address, overrides)
  
  return {
    zap,
    dxswapRouter,
    dxswapFactory, 
    WETH,
    WXDAI,
    GNO,
    DXD,
    COW,
    SWPR,
    wethXdai,
    swprXdai,
    wethGno,
    gnoXdai,
    dxdWeth,
    cowWeth,
  }
}