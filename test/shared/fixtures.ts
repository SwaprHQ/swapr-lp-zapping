import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  Zap,
  ERC20,
  WETH9,
  WXDAI,
  TetherToken,
  Zap__factory,
  DXswapPair,
  DXswapRouter,
  DXswapFactory,
  UniswapV2Pair,
  UniswapV2Factory, 
  UniswapV2Router02, 
} from '../../typechain'
import { ethers } from 'hardhat'
import { Address } from 'hardhat-deploy/types'

interface DXswapFixture {
  zap: Zap
  dxswapRouter: DXswapRouter
  dxswapFactory: DXswapFactory
  dex2Router: DXswapRouter
  dex2Factory: DXswapFactory
  dex3Router: DXswapRouter
  dex3Factory: DXswapFactory  
  uniswapV2Factory: UniswapV2Factory
  uniswapV2Router: UniswapV2Router02
  WETH: WETH9
  WXDAI: WXDAI
  GNO: ERC20
  DXD: ERC20
  COW: ERC20
  SWPR: ERC20
  USDT: TetherToken
  USDT_IMPLEMENTATION_ADDRESS: Address

  wethXdai: DXswapPair
  swprXdai: DXswapPair
  wethGno: DXswapPair
  gnoXdai: DXswapPair
  dxdWeth: DXswapPair
  cowWeth: DXswapPair
  gnoDxd: DXswapPair
  wethGnoDex3: DXswapPair
  usdtWethDex2: DXswapPair
  wxdaiWeth: UniswapV2Pair
  usdtWeth: UniswapV2Pair

  FEE_TO_SETTER: Address
}

export async function dxswapFixture(wallet: SignerWithAddress): Promise<DXswapFixture> {
  const overrides = {
    gasLimit: 9999999
  }

  // GNOSIS CHAIN addresses 
  const WETH_ADDRESS = "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1"
  const WXDAI_ADDRESS = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d"
  const GNO_ADDRESS = "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb"
  const DXD_ADDRESS = "0xb90D6bec20993Be5d72A5ab353343f7a0281f158"
  const COW_ADDRESS = "0x177127622c4A00F3d409B75571e12cB3c8973d3c"
  const USDT_ADDRESS = "0x4ECaBa5870353805a9F068101A40E0f32ed605C6"
  const USDT_IMPLEMENTATION_ADDRESS = "0xf8D1677c8a0c961938bf2f9aDc3F3CFDA759A9d9"
  const SWPR_ADDRESS = "0x532801ED6f82FFfD2DAB70A19fC2d7B2772C4f4b"
  const FEE_TO_SETTER = "0xe3F8F55d7709770a18a30b7e0D16Ae203a2c034F"

  // dex: swapr
  const SWPR_ROUTER_ADDRESS = "0xE43e60736b1cb4a75ad25240E2f9a62Bff65c0C0"
  const SWPR_FACTORY_ADDRESS = "0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179"

  const SWPR_WETH_XDAI = "0x1865d5445010E0baf8Be2eB410d3Eae4A68683c2"
  const SWPR_SWPR_XDAI = "0xa82029c1E11eA0aC18dd3551c6E670787e12E45E"
  const SWPR_WETH_GNO = "0x5fCA4cBdC182e40aeFBCb91AFBDE7AD8d3Dc18a8"
  const SWPR_GNO_XDAI = "0xD7b118271B1B7d26C9e044Fc927CA31DccB22a5a"
  const SWPR_DXD_WETH = "0x1bDe964eCd52429004CbC5812C07C28bEC9147e9"
  const SWPR_GNO_DXD = "0x558d777B24366f011E35A9f59114D1b45110d67B"
  const SWPR_COW_WETH = "0x8028457E452D7221dB69B1e0563AA600A059fab1"

  // dex: levinswap
  const DEX2_ROUTER_ADDRESS = "0xb18d4f69627F8320619A696202Ad2C430CeF7C53"
  const DEX2_FACTORY_ADDRESS = "0x965769C9CeA8A7667246058504dcdcDb1E2975A5"
  const DEX2_USDT_WETH = "0x3653c59E1DAaDc999Ced737DEcE22AaE587633C8"

  const UNISWAP_WXDAI_WETH = "0x2Eb71cD867E7E1d3A17eCD981d592e079B6Cb985"
  const UNISWAP_USDT_WETH = "0x3653c59E1DAaDc999Ced737DEcE22AaE587633C8"

  // dex: honeyswap
  const DEX3_ROUTER_ADDRESS = "0x1C232F01118CB8B424793ae03F870aa7D0ac7f77"
  const DEX3_FACTORY_ADDRESS = "0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7"

  const DEX3_WETH_GNO = "0x28Dbd35fD79f48bfA9444D330D14683e7101d817"

  // deploy tokens
  const erc20Factory = await ethers.getContractFactory("TokenERC20")
  const SWPR = erc20Factory.attach(SWPR_ADDRESS)
  const GNO = erc20Factory.attach(GNO_ADDRESS)
  const DXD = erc20Factory.attach(DXD_ADDRESS)
  const COW = erc20Factory.attach(COW_ADDRESS)

  const usdtFactory = await ethers.getContractFactory("TetherToken")
  const USDT = usdtFactory.attach(USDT_ADDRESS);

  const wethFactory = await ethers.getContractFactory("WETH9")
  const WETH = wethFactory.attach(WETH_ADDRESS)
  
  const wxdaiFactory = await ethers.getContractFactory("WXDAI")
  const WXDAI = wxdaiFactory.attach(WXDAI_ADDRESS)


  // deploy DXswapFactory
  const swapFactory = await ethers.getContractFactory("DXswapFactory")
  const dxswapFactory = swapFactory.attach(SWPR_FACTORY_ADDRESS)
  const dex2Factory = dxswapFactory.attach(DEX2_FACTORY_ADDRESS)
  const dex3Factory = swapFactory.attach(DEX3_FACTORY_ADDRESS)

  // DEX2 (aka: levinswap) is an ~unmodified Uniswap V2 fork
  const uniswapV2FactoryContract = await ethers.getContractFactory("UniswapV2Factory")
  const uniswapV2Factory = uniswapV2FactoryContract.attach(DEX2_FACTORY_ADDRESS)

  // deploy router  
  const routerFactory = await ethers.getContractFactory("DXswapRouter")
  const dxswapRouter = routerFactory.attach(SWPR_ROUTER_ADDRESS)
  const dex2Router = routerFactory.attach(DEX2_ROUTER_ADDRESS)
  const dex3Router = routerFactory.attach(DEX3_ROUTER_ADDRESS)

  // DEX2 (aka: levinswap) is an ~unmodified Uniswap V2 fork
  const uniswapV2RouterFactory = await ethers.getContractFactory("UniswapV2Router02")
  const uniswapV2Router = uniswapV2RouterFactory.attach(DEX2_ROUTER_ADDRESS)

  // initialize DXswapPair factory
  const dxSwapPair_factory = await ethers.getContractFactory("DXswapPair")

  // initialize UniswapV2Pair factory
  const uniswapV2Pair_factory = await ethers.getContractFactory("UniswapV2Pair")

  // create pairs SWPR
  const wethXdai = dxSwapPair_factory.attach(SWPR_WETH_XDAI)
  const wethGno = dxSwapPair_factory.attach(SWPR_WETH_GNO)
  const gnoXdai = dxSwapPair_factory.attach(SWPR_GNO_XDAI)
  const swprXdai = dxSwapPair_factory.attach(SWPR_SWPR_XDAI)
  const dxdWeth = dxSwapPair_factory.attach(SWPR_DXD_WETH)
  const cowWeth = dxSwapPair_factory.attach(SWPR_COW_WETH)
  const gnoDxd = dxSwapPair_factory.attach(SWPR_GNO_DXD)
  const wxdaiWeth = uniswapV2Pair_factory.attach(UNISWAP_WXDAI_WETH)
  const usdtWeth = uniswapV2Pair_factory.attach(UNISWAP_USDT_WETH)
  const usdtWethDex2 = dxSwapPair_factory.attach(DEX2_USDT_WETH);

  // create pairs dex3
  const wethGnoDex3 = dxSwapPair_factory.attach(DEX3_WETH_GNO)
  
  // deploy Relayer and TradeRelayer
  const zap = await new Zap__factory(wallet).deploy(wallet.address, FEE_TO_SETTER, WXDAI_ADDRESS, overrides)
  
  return {
    zap,
    dxswapRouter,
    dxswapFactory,
    dex2Router,
    dex2Factory,
    dex3Router,
    dex3Factory, 
    uniswapV2Factory,
    uniswapV2Router,
    WETH,
    WXDAI,
    GNO,
    DXD,
    COW,
    SWPR,
    USDT,
    USDT_IMPLEMENTATION_ADDRESS,
    wethXdai,
    swprXdai,
    wethGno,
    gnoXdai,
    dxdWeth,
    cowWeth,
    gnoDxd,
    wethGnoDex3,
    wxdaiWeth,
    usdtWeth,
    usdtWethDex2,
    FEE_TO_SETTER
  }
}