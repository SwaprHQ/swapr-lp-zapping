//SPDX-License-Identifier: MIT
pragma solidity =0.8.17;

import {IDXswapFactory} from '@swapr/core/contracts/interfaces/IDXswapFactory.sol';
import {IDXswapPair} from '@swapr/core/contracts/interfaces/IDXswapPair.sol';
import {IERC20} from '@swapr/core/contracts/interfaces/IERC20.sol';
import {IWETH} from '@swapr/core/contracts/interfaces/IWETH.sol';
import {IDXswapRouter} from '@swapr/periphery/contracts/interfaces/IDXswapRouter.sol';
import {TransferHelper} from '@swapr/periphery/contracts/libraries/TransferHelper.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import {Ownable} from './peripherals/Ownable.sol';

error ForbiddenValue();
error InsufficientMinAmount();
error InvalidPair();
error InvalidStartPath();
error InvalidTargetPath();
error OnlyFeeSetter();
error InvalidRouterOrFactory();
error DexIndexAlreadyUsed();
error TemporarilyPaused();

struct DEX {
    string name;
    address router;
    address factory;
}

struct SwapTx {
    uint256 amount;
    uint256 amountMin;
    address[] path;
    uint8 dexIndex;
}

struct ZapInTx {
    uint256 amountAMin;
    uint256 amountBMin;
    uint256 amountLPMin;
    uint8 dexIndex;
}

struct ZapOutTx {
    uint256 amountLpFrom;
    uint256 amountTokenToMin;
    uint8 dexIndex;
}

/**  
@title Zap
@notice Allows to zapIn from an ERC20 or native currency to ERC20 pair
and zapOut from an ERC20 pair to an ERC20 or native currency
@dev Dusts from zap can be withdrawn by owner
*/
contract Zap is Ownable, ReentrancyGuard {
    bool public stopped = false; // pause the contract if emergency
    uint16 public protocolFee = 50; // default 0.5% of zap amount protocol fee (range: 0-10000)
    uint16 public affiliateSplit; // % share of protocol fee 0-100 % (range: 0-10000)
    address public feeToSetter;
    address public immutable nativeCurrencyWrapper;

    // set list of supported DEXs for zap
    mapping(uint8 => DEX) public supportedDEXs;
    // if true, protocol fee is not deducted
    mapping(address => bool) public feeWhitelist;
    // restrict affiliates
    mapping(address => bool) public affiliates;
    // affiliate => token => amount
    mapping(address => mapping(address => uint256)) public affiliateBalance;
    // token => amount
    mapping(address => uint256) public totalAffiliateBalance;

    // native currency address used for balances
    address private constant nativeCurrencyAddress = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // placeholder for swap deadline
    uint256 private constant deadline = 0xf000000000000000000000000000000000000000000000000000000000000000;

    event ZapIn(
        address sender,
        address receiver,
        address tokenFrom,
        uint256 amountFrom,
        address pairTo,
        uint256 amountTo
    );

    event ZapOut(
        address sender,
        address receiver,
        address pairFrom,
        uint256 amountFrom,
        address tokenTo,
        uint256 amountTo
    );

    // circuit breaker modifiers
    modifier stopInEmergency() {
        if (stopped) {
            revert TemporarilyPaused();
        } else {
            _;
        }
    }

    /**  
    @notice Constructor
    @param _owner The address of contract owner
    @param _feeToSetter The address setter of fee receiver
    @param _nativeCurrencyWrapper The address of wrapped native currency
    */
    constructor(address _owner, address _feeToSetter, address _nativeCurrencyWrapper) Ownable(_owner) {
        feeToSetter = _feeToSetter;
        nativeCurrencyWrapper = _nativeCurrencyWrapper;
    }

    /// @notice Allows the contract to receive native currency
    /// @dev It is necessary to be able to receive native currency when using nativeCurrencyWrapper.withdraw()
    receive() external payable {}

    /**
    @notice This function is used to invest in given Uniswap V2 pair through ETH/ERC20 Tokens
    @dev Pool's token A and token B don't need to be sorted
    @param zap Data for zap in - min amounts and dex index
    @param swapTokenA Data for swap tx pool's token A - amounts, path & DEX
    @param swapTokenB Data for swap tx pool's token B - amounts, path & DEX
    @param receiver LP token receiver address
    @param affiliate Affiliate address
    @param transferResidual Set false to save gas by donating the residual remaining after a ZapTx
    @return lpBought Amount of LP tokens transferred to receiver 
    @return lpToken LP token address
     */
    function zapIn(
        ZapInTx calldata zap,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        address receiver,
        address affiliate,
        bool transferResidual
    ) external payable nonReentrant stopInEmergency returns (uint256 lpBought, address lpToken) {
        // check if start token is the same for both paths
        if (swapTokenA.path[0] != swapTokenB.path[0]) revert InvalidStartPath();

        (uint256 amountAToInvest, uint256 amountBToInvest) = _pullTokens(swapTokenA, swapTokenB, affiliate);
        (lpBought, lpToken) = _performZapIn(
            amountAToInvest,
            amountBToInvest,
            swapTokenA,
            swapTokenB,
            zap,
            transferResidual
        );

        if (lpBought < zap.amountLPMin) revert InsufficientMinAmount();
        TransferHelper.safeTransfer(lpToken, receiver, lpBought);

        emit ZapIn(msg.sender, receiver, swapTokenA.path[0], swapTokenA.amount + swapTokenB.amount, lpToken, lpBought);
    }

    /**
    @notice ZapTx out LP token in a single token
    @dev Pool's token A and token B don't need to be sorted
    @param zap Data for zap out - min amounts & DEX
    @param swapTokenA Data for swap tx pool's token A - amounts, path & DEX
    @param swapTokenB Data for swap tx pool's token B - amounts, path & DEX
    @param receiver Target token receiver address
    @param affiliate Affiliate address
    @return amountTransferred Amount of tokenTo transferred to receiver 
    @return tokenTo Target token address
    */
    function zapOut(
        ZapOutTx calldata zap,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        address receiver,
        address affiliate
    ) external nonReentrant stopInEmergency returns (uint256 amountTransferred, address tokenTo) {
        // check if target token is the same for both paths
        if (swapTokenA.path[swapTokenA.path.length - 1] != swapTokenB.path[swapTokenB.path.length - 1])
            revert InvalidTargetPath();
        tokenTo = swapTokenA.path[swapTokenA.path.length - 1];

        (uint256 amountTo, address lpToken) = _performZapOut(zap, swapTokenA, swapTokenB);

        uint256 totalProtocolFeePortion;
        if (tokenTo == address(0)) {
            // unwrap to native currency
            IWETH(nativeCurrencyWrapper).withdraw(amountTo);
            totalProtocolFeePortion = _subtractProtocolFee(nativeCurrencyAddress, amountTo, affiliate);

            amountTransferred = amountTo - totalProtocolFeePortion;
            TransferHelper.safeTransferETH(receiver, amountTransferred);
        } else {
            totalProtocolFeePortion = _subtractProtocolFee(tokenTo, amountTo, affiliate);

            amountTransferred = amountTo - totalProtocolFeePortion;
            TransferHelper.safeTransfer(tokenTo, receiver, amountTransferred);
        }

        if (amountTransferred < zap.amountTokenToMin) revert InsufficientMinAmount();

        emit ZapOut(msg.sender, receiver, lpToken, zap.amountLpFrom, tokenTo, amountTransferred);
    }

    /** 
    @notice Set address exempt from fee
    */
    function setFeeWhitelist(address zapAddress, bool status) external onlyOwner {
        feeWhitelist[zapAddress] = status;
    }

    /** 
    @notice Set new affiliate split value
    */
    function setNewAffiliateSplit(uint16 _newAffiliateSplit) external onlyOwner {
        if (_newAffiliateSplit > 10000) revert ForbiddenValue();
        affiliateSplit = _newAffiliateSplit;
    }

    /** 
    @notice Set new affiliate status for specified address
    */
    function setAffiliateStatus(address _affiliate, bool _status) external onlyOwner {
        affiliates[_affiliate] = _status;
    }

    /** 
    @notice Set DEX's info which can be used for zap tx
    @param _dexIndex Index used to identify DEX within the contract
    @param _name DEX's conventional name used to identify DEX by the user 
    @param _router DEX's router address
    @param _factory DEX's factory address
    */
    function setSupportedDEX(
        uint8 _dexIndex,
        string calldata _name,
        address _router,
        address _factory
    ) external onlyOwner {
        if (supportedDEXs[_dexIndex].router != address(0)) revert DexIndexAlreadyUsed();
        if (_factory != IDXswapRouter(_router).factory()) revert InvalidRouterOrFactory();
        supportedDEXs[_dexIndex] = DEX({name: _name, router: _router, factory: _factory});
    }

    /** 
    @notice Set the fee setter address
    @param _feeToSetter Fee setter address
    */
    function setFeeToSetter(address _feeToSetter) external {
        if (msg.sender != feeToSetter) revert OnlyFeeSetter();
        feeToSetter = _feeToSetter;
    }

    /**  
    @notice Set the protocol fee percent
    @param _protocolFee The new protocol fee percent 0-100% (range: 0-10000)
    */
    function setProtocolFee(uint16 _protocolFee) external {
        if (msg.sender != feeToSetter) revert OnlyFeeSetter();
        if (_protocolFee > 10000) revert ForbiddenValue();
        protocolFee = _protocolFee;
    }

    /** 
    @notice Withdraw protocolFee share, retaining affilliate share 
    @param tokens Tokens' addresses transferred to the owner as protocol fee
    */
    function withdrawTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 qty;

            if (tokens[i] == nativeCurrencyAddress) {
                qty = address(this).balance - totalAffiliateBalance[nativeCurrencyAddress];
                TransferHelper.safeTransferETH(owner, qty);
            } else {
                qty = IERC20(tokens[i]).balanceOf(address(this)) - totalAffiliateBalance[tokens[i]];
                TransferHelper.safeTransfer(tokens[i], owner, qty);
            }
        }
    }

    /**  
    @notice Withdraw affilliate share
    @param tokens Tokens' addresses transferred to the msg sender as affiliate share of protocol fee
    */
    function affilliateWithdraw(address[] calldata tokens) external {
        uint256 tokenBalance;
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenBalance = affiliateBalance[msg.sender][tokens[i]];
            affiliateBalance[msg.sender][tokens[i]] = 0;
            totalAffiliateBalance[tokens[i]] = totalAffiliateBalance[tokens[i]] - tokenBalance;

            if (tokens[i] == nativeCurrencyAddress) {
                TransferHelper.safeTransferETH(msg.sender, tokenBalance);
            } else {
                TransferHelper.safeTransfer(tokens[i], msg.sender, tokenBalance);
            }
        }
    }

    /** 
    @notice Pause the contract
    */
    function toggleContractActive() external onlyOwner {
        stopped = !stopped;
    }

    /** 
    @notice Check if DEX's address is valid and supported
    @return router DEX's router address
    @return factory DEX's factory address
    */
    function getSupportedDEX(uint8 _dexIndex) public view returns (address router, address factory) {
        router = supportedDEXs[_dexIndex].router;
        factory = supportedDEXs[_dexIndex].factory;
        if (router == address(0) || factory == address(0)) revert InvalidRouterOrFactory();
    }

    /** 
    @notice Internal zap in
    */
    function _performZapIn(
        uint256 amountAToInvest,
        uint256 amountBToInvest,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        ZapInTx calldata zap,
        bool transferResidual
    ) internal returns (uint256 liquidity, address lpToken) {
        // check if dex address is valid and supported
        (address router, address factory) = getSupportedDEX(zap.dexIndex);

        lpToken = IDXswapFactory(factory).getPair(
            swapTokenA.path[swapTokenA.path.length - 1],
            swapTokenB.path[swapTokenB.path.length - 1]
        );

        (uint256 tokenABought, uint256 tokenBBought) = _buyTokens(
            amountAToInvest,
            amountBToInvest,
            swapTokenA,
            swapTokenB
        );

        (, , liquidity) = _addLiquidity(
            swapTokenA.path[swapTokenA.path.length - 1],
            swapTokenB.path[swapTokenB.path.length - 1],
            tokenABought,
            tokenBBought,
            swapTokenA.amountMin,
            swapTokenB.amountMin,
            router,
            transferResidual
        );
    }

    /** 
    @notice Internal zap out
    */
    function _performZapOut(
        ZapOutTx calldata zap,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB
    ) internal returns (uint256 amountTo, address lpToken) {
        // check if dex address is valid and supported
        (address router, address factory) = getSupportedDEX(zap.dexIndex);

        lpToken = _pullLpTokens(zap.amountLpFrom, swapTokenA.path[0], swapTokenB.path[0], router, factory);

        // router.removeLiquidity() sorts tokens so no need to set them in exact order
        (uint256 amountA, uint256 amountB) = IDXswapRouter(router).removeLiquidity(
            swapTokenA.path[0],
            swapTokenB.path[0],
            zap.amountLpFrom,
            swapTokenA.amountMin,
            swapTokenB.amountMin,
            address(this),
            deadline
        );

        if (amountA == 0 || amountB == 0) revert InsufficientMinAmount();

        (address routerSwapA, ) = getSupportedDEX(swapTokenA.dexIndex);
        (address routerSwapB, ) = getSupportedDEX(swapTokenB.dexIndex);

        if (swapTokenA.path[swapTokenA.path.length - 1] == address(0)) {
            // set target token for native currency wrapper instead of address(0x00)
            address[] memory pathA = swapTokenA.path;
            address[] memory pathB = swapTokenB.path;
            pathA[pathA.length - 1] = nativeCurrencyWrapper;
            pathB[pathB.length - 1] = nativeCurrencyWrapper;

            amountTo =
                _swapExactTokensForTokens(amountA, swapTokenA.amountMin, pathA, routerSwapA) +
                _swapExactTokensForTokens(amountB, swapTokenB.amountMin, pathB, routerSwapB);
        } else {
            amountTo =
            _swapExactTokensForTokens(amountA, swapTokenA.amountMin, swapTokenA.path, routerSwapA) +
            _swapExactTokensForTokens(amountB, swapTokenB.amountMin, swapTokenB.path, routerSwapB);
        }
    }

    /** 
    @notice Transfer tokens or native currency to the contract for zap in
    @param swapTokenA Data for swap tx pool's token A - amounts, path & DEX
    @param swapTokenB Data for swap tx pool's token B - amounts, path & DEX
    @param affiliate Affiliate address
    @return amountAToInvest Token A amount to invest after fee subtract
    @return amountBToInvest Token B amount to invest after fee subtract
    */
    function _pullTokens(
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        address affiliate
    ) internal returns (uint256 amountAToInvest, uint256 amountBToInvest) {
        address fromTokenAddress = swapTokenA.path[0];
        uint256 totalAmount = swapTokenA.amount + swapTokenB.amount;

        if (fromTokenAddress == address(0)) {
            fromTokenAddress = nativeCurrencyAddress;
        } else {
            //transfer tokens to zap contract
            TransferHelper.safeTransferFrom(fromTokenAddress, msg.sender, address(this), totalAmount);
        }

        // subtract protocol fee
        return (
            amountAToInvest = swapTokenA.amount - _subtractProtocolFee(fromTokenAddress, swapTokenA.amount, affiliate),
            amountBToInvest = swapTokenB.amount - _subtractProtocolFee(fromTokenAddress, swapTokenB.amount, affiliate)
        );
    }

    /** 
    @notice Transfer LP tokens to the contract for zap out
    @param amount LP tokens amount
    @param tokenA Pair's token A address 
    @param tokenB Pair's token B address
    @param router DEX router address
    @param factory DEX factory address
    @return lpToken LP tokens transferred from msg sender to the zap contract
    */
    function _pullLpTokens(
        uint256 amount,
        address tokenA,
        address tokenB,
        address router,
        address factory
    ) internal returns (address lpToken) {
        // validate pair
        lpToken = IDXswapFactory(factory).getPair(tokenA, tokenB);
        if (lpToken == address(0)) revert InvalidPair();

        _approveTokenIfNeeded(lpToken, amount, router);

        // pull LP tokens from sender
        TransferHelper.safeTransferFrom(lpToken, msg.sender, address(this), amount);
    }

    /** 
    @notice Subtract protocol fee for fee receiver and affiliate if it's > 0 and the address is not whitelisted
    @param token Token address
    @param amount Token amount
    @param affiliate Affiliate address
    @return totalProtocolFeePortion Total amount of protocol fee taken
    */
    function _subtractProtocolFee(
        address token,
        uint256 amount,
        address affiliate
    ) internal returns (uint256 totalProtocolFeePortion) {
        bool whitelisted = feeWhitelist[msg.sender];
        if (!whitelisted && protocolFee > 0) {
            totalProtocolFeePortion = (amount * protocolFee) / 10000;

            if (affiliates[affiliate] && affiliateSplit > 0) {
                uint256 affiliatePortion = (totalProtocolFeePortion * affiliateSplit) / 10000;
                affiliateBalance[affiliate][token] = affiliateBalance[affiliate][token] + affiliatePortion;
                totalAffiliateBalance[token] = totalAffiliateBalance[token] + affiliatePortion;
            }
        }
    }

    /** 
    @notice Internal fct for swapping lp pair's tokens
    @param amountAToInvest Amount from of pair's tokenA to swap
    @param amountBToInvest Amount from of pair's tokenB to swap
    @param swapTokenA Data for swap tx pool's token A - amounts, path & DEX
    @param swapTokenB Data for swap tx pool's token B - amounts, path & DEX
    */
    function _buyTokens(
        uint256 amountAToInvest,
        uint256 amountBToInvest,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB
    ) internal returns (uint256 tokenABought, uint256 tokenBBought) {
        //
        (address routerSwapA, ) = getSupportedDEX(swapTokenA.dexIndex);
        (address routerSwapB, ) = getSupportedDEX(swapTokenB.dexIndex);
        // wrap native currency
        if (swapTokenA.path[0] == address(0)) {
            address[] memory pathA = swapTokenA.path;
            address[] memory pathB = swapTokenB.path;

            IWETH(nativeCurrencyWrapper).deposit{value: amountAToInvest + amountBToInvest}();
            // set path to start with native currency wrapper instead of address(0x00)
            pathA[0] = nativeCurrencyWrapper;
            pathB[0] = nativeCurrencyWrapper;

            tokenABought = _swapExactTokensForTokens(
                amountAToInvest,
                swapTokenA.amountMin,
                pathA,
                routerSwapA
            );
            tokenBBought = _swapExactTokensForTokens(
                amountBToInvest,
                swapTokenB.amountMin,
                pathB,
                routerSwapB
            );

            return (tokenABought, tokenBBought);
        }

        tokenABought = _swapExactTokensForTokens(
            amountAToInvest,
            swapTokenA.amountMin,
            swapTokenA.path,
            routerSwapA
        );
        tokenBBought = _swapExactTokensForTokens(
            amountBToInvest,
            swapTokenB.amountMin,
            swapTokenB.path,
            routerSwapB
        );
    }

    /**  
    @notice Swaps exact tokenFrom following path
    @param amountFrom The amount of tokenFrom to swap
    @param amountToMin The min amount of tokenTo to receive
    @param path The path to follow to swap tokenFrom to TokenTo
    @return amountTo The amount of token received
    */
    function _swapExactTokensForTokens(
        uint256 amountFrom,
        uint256 amountToMin,
        address[] memory path,
        address router
    ) internal returns (uint256 amountTo) {
        uint256 len = path.length;

        // swap tokens following the path
        if (len > 1) {
            address tokenTo = path[len - 1];
            uint256 balanceBefore = IERC20(tokenTo).balanceOf(address(this));
            _approveTokenIfNeeded(path[0], amountFrom, router);
            IDXswapRouter(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountFrom,
                amountToMin,
                path,
                address(this),
                deadline
            );
            amountTo = IERC20(tokenTo).balanceOf(address(this)) - balanceBefore;
        } else {
            // no swap needed because path is only 1-element
            // ZapIn case: token already on Zap contract balance
            amountTo = amountFrom;
        }
        if (amountTo < amountToMin) revert InsufficientMinAmount();
    }

    /**  
    @notice Add liquidity to the pool
    @param tokenA The address of the first pool token
    @param tokenB The address of the second pool token
    @param amountADesired The desired amount of token A to add
    @param amountBDesired The desired amount of token A to add
    @param amountAMin The minimum amount of token A to receive
    @param amountBMin The minimum amount of token A to receive
    @param router The address of platform's router
    @param transferResidual Set false to save gas by donating the residual remaining after a ZapTx
    @return amountA Token A amount added to LP
    @return amountB Token B amount added to LP
    @return liquidity LP tokens minted
    */
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address router,
        bool transferResidual
    ) internal returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        _approveTokenIfNeeded(tokenA, amountADesired, router);
        _approveTokenIfNeeded(tokenB, amountBDesired, router);

        (amountA, amountB, liquidity) = IDXswapRouter(router).addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        );

        if (transferResidual) {
            // returning residue in tokenA, if any
            if (amountADesired - amountA > 0) {
                TransferHelper.safeTransfer(tokenA, msg.sender, (amountADesired - amountA));
            }

            // returning residue in tokenB, if any
            if (amountBDesired - amountB > 0) {
                TransferHelper.safeTransfer(tokenB, msg.sender, (amountBDesired - amountB));
            }
        }
    }

    /**  
    @notice Approves the token if needed
    @param token The address of the token
    @param amount The amount of token to send
    */
    function _approveTokenIfNeeded(address token, uint256 amount, address router) internal {
        if (IERC20(token).allowance(address(this), router) < amount) {
            // Note: some tokens (e.g. USDT, KNC) allowance must be first reset
            // to 0 before being able to update it
            TransferHelper.safeApprove(token, router, 0);
            TransferHelper.safeApprove(token, router, amount);
        }
    }
}
