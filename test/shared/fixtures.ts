import { expandTo18Decimals } from './utilities'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { DXswapFactory, DXswapFactory__factory, DXswapPair, DXswapPair__factory, DXswapRouter, DXswapRouter__factory, ERC20, ERC20__factory, TokenERC20__factory, WETH9, WETH9__factory, WXDAI, WXDAI__factory, Zap, Zap__factory } from '../../typechain'
import { ethers } from 'hardhat'
import { Address } from 'hardhat-deploy/types'

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
  gnoDxd: DXswapPair

  FEE_TO_SETTER: Address
  }

  

export async function dxswapFixture(wallet: SignerWithAddress): Promise<DXswapFixture> {
  const overrides = {
    gasLimit: 9999999
  }
const WETH_ADDRESS = "0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1"
const WXDAI_ADDRESS = "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d"
const GNO_ADDRESS = "0x9c58bacc331c9aa871afd802db6379a98e80cedb"
const DXD_ADDRESS = "0xb90D6bec20993Be5d72A5ab353343f7a0281f158"
const COW_ADDRESS = "0x177127622c4A00F3d409B75571e12cB3c8973d3c"
const SWPR_ADDRESS = "0x532801ED6f82FFfD2DAB70A19fC2d7B2772C4f4b"

const ROUTER_ADDRESS = "0xE43e60736b1cb4a75ad25240E2f9a62Bff65c0C0"
const FACTORY_ADDRESS = "0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179"

const WETH_XDAI_ADDRESS = "0x1865d5445010e0baf8be2eb410d3eae4a68683c2"
const SWPR_XDAI_ADDRESS = "0xa82029c1E11eA0aC18dd3551c6E670787e12E45E"
const WETH_GNO_ADDRESS = "0x5fCA4cBdC182e40aeFBCb91AFBDE7AD8d3Dc18a8"
const GNO_XDAI_ADDRESS = "0xD7b118271B1B7d26C9e044Fc927CA31DccB22a5a"
const DXD_WETH_ADDRESS = "0x1bde964ecd52429004cbc5812c07c28bec9147e9"
const GNO_DXD_ADDRESS = "0x558d777b24366f011e35a9f59114d1b45110d67b"
const COW_WETH_ADDRESS = "0x8028457E452D7221dB69B1e0563AA600A059fab1"

const FEE_TO_SETTER = "0xe3f8f55d7709770a18a30b7e0d16ae203a2c034f"

  // deploy tokens
  const erc20Factory = await ethers.getContractFactory("ERC20")
  const SWPR = erc20Factory.attach(SWPR_ADDRESS)
  const GNO = erc20Factory.attach(GNO_ADDRESS)
  const DXD = erc20Factory.attach(DXD_ADDRESS)
  const COW = erc20Factory.attach(COW_ADDRESS)

  const wethFactory = await ethers.getContractFactory("WETH9")
  const WETH = wethFactory.attach(WETH_ADDRESS)
  
  const wxdaiFactory = await ethers.getContractFactory("WXDAI")
  const WXDAI = wxdaiFactory.attach(WXDAI_ADDRESS)


  // deploy DXswapFactory
  const swapFactory = await ethers.getContractFactory("DXswapFactory")
  const dxswapFactory = swapFactory.attach(FACTORY_ADDRESS)

  // deploy router  
  const routerFactory = await ethers.getContractFactory("DXswapRouter")
  const dxswapRouter = routerFactory.attach(ROUTER_ADDRESS)

  // initialize DXswapPair factory
  const dxSwapPair_factory = await ethers.getContractFactory("DXswapPair")

  // create pairs
  const wethXdai = dxSwapPair_factory.attach(WETH_XDAI_ADDRESS)
  const wethGno = dxSwapPair_factory.attach(WETH_GNO_ADDRESS)
  const gnoXdai = dxSwapPair_factory.attach(GNO_XDAI_ADDRESS)
  const swprXdai = dxSwapPair_factory.attach(SWPR_XDAI_ADDRESS)
  const dxdWeth = dxSwapPair_factory.attach(DXD_WETH_ADDRESS)
  const cowWeth = dxSwapPair_factory.attach(COW_WETH_ADDRESS)
  const gnoDxd = dxSwapPair_factory.attach(GNO_DXD_ADDRESS)

  
  // deploy Relayer and TradeRelayer
  const zap = await new Zap__factory(wallet).deploy(FACTORY_ADDRESS, ROUTER_ADDRESS, WXDAI_ADDRESS, FEE_TO_SETTER, overrides)
  
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
    gnoDxd,
    FEE_TO_SETTER
  }
}