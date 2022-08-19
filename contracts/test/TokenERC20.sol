pragma solidity =0.8.15;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract TokenERC20 is ERC20("Test Token", "TT") {
    constructor(uint _totalSupply) {
        _mint(msg.sender, _totalSupply);
    }
}
