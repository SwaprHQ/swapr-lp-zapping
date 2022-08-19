pragma solidity =0.6.6;

import '@swapr/periphery/contracts/DXswapRouter.sol';

contract Router is DXswapRouter {
    constructor(address _factory, address _WETH) DXswapRouter(address(0), address(0)) public {}
}
