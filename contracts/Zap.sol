//SPDX-License-Identifier: MIT
pragma solidity =0.8.17;

import {IDXswapFactory} from '@swapr/core/contracts/interfaces/IDXswapFactory.sol';
import {IDXswapPair} from '@swapr/core/contracts/interfaces/IDXswapPair.sol';
import {IERC20} from '@swapr/core/contracts/interfaces/IERC20.sol';
import {IWETH} from '@swapr/core/contracts/interfaces/IWETH.sol';
import {IDXswapRouter} from '@swapr/periphery/contracts/interfaces/IDXswapRouter.sol';
import {TransferHelper} from '@swapr/periphery/contracts/libraries/TransferHelper.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';
import './peripherals/Ownable.sol';

error ForbiddenValue();
error InsufficientMinAmount();
error InvalidInputAmount();
error InvalidPair();
error InvalidStartPath();
error InvalidTargetPath();
error OnlyFeeSetter();
error ZeroAddressInput();
error InvalidRouterOrFactory();
error DexIndexAlreadyUsed();

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

struct ZapTx {
    uint256 amountAMin;
    uint256 amountBMin;
    uint256 amountLPMin;
    uint8 dexIndex;
    address to;
}

/// @title Zap
/// @notice Allows to zapIn from an ERC20 or native currency to ERC20 pair
/// and zapOut from an ERC20 pair to an ERC20 or native currency
/// @dev Dusts from zap can be withdrawn by owner
contract Zap is Ownable, ReentrancyGuard {
    bool public stopped = false; // pause the contract if emergency
    uint16 public protocolFee = 50; // default 0.5% of zap amount protocol fee (range: 0-10000)
    uint16 affiliateSplit; // % share of protocol fee (0-100 %) (range: 0-10000)
    address public feeTo;
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

    address private constant ETHAddress = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 private constant deadline = 0xf000000000000000000000000000000000000000000000000000000000000000;

    event ZapIn(
        address indexed sender,
        address indexed tokenFrom,
        uint256 amountFrom,
        address indexed pairTo,
        uint256 amountTo
    );

    event ZapOut(
        address indexed sender,
        address indexed pairFrom,
        uint256 amountFrom,
        address tokenTo,
        uint256 amountTo
    );

    // circuit breaker modifiers
    modifier stopInEmergency() {
        if (stopped) {
            revert('Temporarily Paused');
        } else {
            _;
        }
    }

    /// @notice Constructor
    /// @param _owner The address of contract owner
    /// @param _feeToSetter The address setter of fee receiver
    /// @param _nativeCurrencyWrapper The address of wrapped native currency
    constructor(
        address _owner,
        address _feeToSetter,
        address _nativeCurrencyWrapper
    ) Ownable(_owner) {
        feeToSetter = _feeToSetter;
        nativeCurrencyWrapper = _nativeCurrencyWrapper;
    }

    /**
    @notice This function is used to invest in given Uniswap V2 pair through ETH/ERC20 Tokens
    @param affiliate Affiliate address
    @param transferResidual Set false to save gas by donating the residual remaining after a ZapTx
     */
    function zapIn(
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        ZapTx calldata zap,
        address affiliate,
        bool transferResidual
    ) external payable nonReentrant stopInEmergency returns (uint256 lpBought, address lpToken) {
        // check if start token is the same for both paths
        if (swapTokenA.path[0] != swapTokenB.path[0]) revert InvalidStartPath();

        // TODO calculate amount to invest
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
        TransferHelper.safeTransfer(lpToken, msg.sender, lpBought);

        emit ZapIn(msg.sender, swapTokenA.path[0], swapTokenA.amount + swapTokenB.amount, lpToken, lpBought);
    }

    /**
    @notice ZapTx out LP token in a single token
    @dev path0 and path1 do not need to be ordered
    @param amountLpFrom The amount of liquidity to zap
    @param amountToMin The min amount to receive of tokenTo

    @param affiliate Affiliate address
    */
    function zapOut(
        uint256 amountLpFrom,
        uint256 amountToMin,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        ZapTx calldata zap,
        address to,
        address affiliate
    ) public nonReentrant stopInEmergency returns (uint256 amountTransferred, address tokenTo) {
        // check if target token is the same for both paths
        if (swapTokenA.path[swapTokenA.path.length - 1] != swapTokenB.path[swapTokenB.path.length - 1])
            revert InvalidTargetPath();
        tokenTo = swapTokenA.path[swapTokenA.path.length - 1];

        (uint256 amountTo, address lpToken) = _performZapOut(amountLpFrom, swapTokenA, swapTokenB, zap);
        if (amountTo < amountToMin) revert InsufficientMinAmount();

        amountTransferred = _getFeeAndTransferTokens(tokenTo, amountTo, to, affiliate);

        emit ZapOut(msg.sender, lpToken, amountLpFrom, tokenTo, amountTransferred);
    }

    // - to Pause the contract
    function toggleContractActive() public onlyOwner {
        stopped = !stopped;
    }

    function _pullTokens(
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        address affiliate
    ) internal returns (uint256 amountAToInvest, uint256 amountBToInvest) {
        // check if start token is the same for both paths
        if (swapTokenA.path[0] != swapTokenB.path[0]) revert InvalidStartPath();
        address fromToken = swapTokenA.path[0];
        uint256 totalAmount = swapTokenA.amount + swapTokenB.amount;

        if (fromToken == address(0)) {
            if (msg.value != totalAmount) revert InvalidInputAmount();

            // subtract protocol fee
            return (
                amountAToInvest = msg.value - _subtractProtocolFee(ETHAddress, swapTokenA.amount, affiliate),
                amountBToInvest = msg.value - _subtractProtocolFee(ETHAddress, swapTokenB.amount, affiliate)
            );
        }

        if (totalAmount == 0 || msg.value > 0) revert InvalidInputAmount();

        //transfer token to zap contract
        TransferHelper.safeTransferFrom(fromToken, msg.sender, address(this), totalAmount);

        // subtract protocol fee
        return (
            amountAToInvest = swapTokenA.amount - _subtractProtocolFee(fromToken, swapTokenA.amount, affiliate),
            amountBToInvest = swapTokenB.amount - _subtractProtocolFee(fromToken, swapTokenB.amount, affiliate)
        );
    }

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

    function _performZapIn(
        uint256 amountAToInvest,
        uint256 amountBToInvest,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        ZapTx calldata zap,
        bool transferResidual
    ) internal returns (uint256 liquidity, address lpToken) {
        // check if dex is supported
        (address router, address factory) = getSupportedDEX(zap.dexIndex);

        // get pair and check if exists
        lpToken = _getPairAddress(
            swapTokenA.path[swapTokenA.path.length - 1],
            swapTokenB.path[swapTokenB.path.length - 1],
            factory
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

    function _performZapOut(
        uint256 amountLpFrom,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        ZapTx calldata zap
    ) internal returns (uint256 amountTo, address lpToken) {
        if (amountLpFrom == 0) revert InvalidInputAmount();
        // check if dex is supported
        (address router, address factory) = getSupportedDEX(zap.dexIndex);
        // validate pair
        lpToken = _getPairAddress(swapTokenA.path[0], swapTokenB.path[0], factory);
        address token0 = IDXswapPair(lpToken).token0();
        address token1 = IDXswapPair(lpToken).token1();

        (uint256 amount0, uint256 amount1) = _removeLiquidity(
            token0,
            token1,
            lpToken,
            amountLpFrom,
            swapTokenA.amountMin,
            swapTokenB.amountMin,
            router
        );

        //swaps tokens to target token through proper path
        if (swapTokenA.path[0] == token0 && swapTokenB.path[0] == token1) {
            amountTo = _swapLpTokensToTargetTokens(amount0, amount1, swapTokenA, swapTokenB, address(this));
        } else if (swapTokenA.path[0] == token1 && swapTokenB.path[0] == token0) {
            amountTo = _swapLpTokensToTargetTokens(amount1, amount0, swapTokenA, swapTokenB, address(this));
        } else revert InvalidPair();
    }

    function _buyTokens(
        uint256 amountAToInvest,
        uint256 amountBToInvest,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB
    ) internal returns (uint256 tokenABought, uint256 tokenBBought) {
        // wrap native currency
        if (swapTokenA.path[0] == address(0)) {
            address[] memory pathA = swapTokenA.path;
            address[] memory pathB = swapTokenB.path;

            IWETH(nativeCurrencyWrapper).deposit{value: amountAToInvest + amountAToInvest}();
            // set path to start with native currency wrapper instead of address(0x00)
            pathA[0] = nativeCurrencyWrapper;
            pathB[0] = nativeCurrencyWrapper;

            tokenABought = _swapExactTokensForTokens(
                amountAToInvest,
                swapTokenA.amountMin,
                pathA,
                address(this),
                supportedDEXs[swapTokenA.dexIndex].router
            );
            tokenBBought = _swapExactTokensForTokens(
                amountBToInvest,
                swapTokenB.amountMin,
                pathB,
                address(this),
                supportedDEXs[swapTokenB.dexIndex].router
            );

            return (tokenABought, tokenBBought);
        }

        tokenABought = _swapExactTokensForTokens(
            amountAToInvest,
            swapTokenA.amountMin,
            swapTokenA.path,
            address(this),
            supportedDEXs[swapTokenA.dexIndex].router
        );
        tokenBBought = _swapExactTokensForTokens(
            amountBToInvest,
            swapTokenB.amountMin,
            swapTokenB.path,
            address(this),
            supportedDEXs[swapTokenB.dexIndex].router
        );
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address router,
        bool transferResidual
    )
        internal
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        )
    {
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
            // returning residue in token0, if any
            if (amountADesired - amountA > 0) {
                TransferHelper.safeTransfer(tokenA, msg.sender, (amountADesired - amountA));
            }

            // returning residue in token1, if any
            if (amountBDesired - amountB > 0) {
                TransferHelper.safeTransfer(tokenB, msg.sender, (amountBDesired - amountB));
            }
        }
    }

    /// @notice Swaps exact tokenFrom following path
    /// @param amountFrom The amount of tokenFrom to swap
    /// @param amountToMin The min amount of tokenTo to receive
    /// @param path The path to follow to swap tokenFrom to TokenTo
    /// @param to The address that will receive tokenTo
    /// @return amountTo The amount of token received
    function _swapExactTokensForTokens(
        uint256 amountFrom,
        uint256 amountToMin,
        address[] memory path,
        address to,
        address router
    ) internal returns (uint256 amountTo) {
        uint256 len = path.length;
        address tokenTo = path[len - 1];
        uint256 balanceBefore = IERC20(tokenTo).balanceOf(to);

        // swap tokens following the path
        if (len > 1) {
            _approveTokenIfNeeded(path[0], amountFrom, router);
            IDXswapRouter(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountFrom,
                amountToMin,
                path,
                to,
                deadline
            );
            amountTo = IERC20(tokenTo).balanceOf(to) - balanceBefore;
        } else {
            // no swap needed because path is only 1-element
            if (to != address(this)) {
                // transfer token to receiver address
                TransferHelper.safeTransfer(tokenTo, to, amountFrom);
                amountTo = IERC20(tokenTo).balanceOf(to) - balanceBefore;
            } else {
                // ZapIn case: token already on ZapTx contract balance
                amountTo = amountFrom;
            }
        }
        if (amountTo < amountToMin) revert InsufficientMinAmount();
    }

    function setFeeWhitelist(address zapAddress, bool status) external onlyOwner {
        feeWhitelist[zapAddress] = status;
    }

    function setNewAffiliateSplit(uint16 _newAffiliateSplit) external onlyOwner {
        if (_newAffiliateSplit > 10000) revert ForbiddenValue();
        affiliateSplit = _newAffiliateSplit;
    }

    function setAffiliateStatus(address _affiliate, bool _status) external onlyOwner {
        affiliates[_affiliate] = _status;
    }

    function setSupportedDEX(
        uint8 _dexIndex,
        string calldata _name,
        address _router,
        address _factory
    ) external onlyOwner {
        if (supportedDEXs[_dexIndex].router != address(0)) revert DexIndexAlreadyUsed();
        if (_router == address(0) || _factory == address(0)) revert ZeroAddressInput();
        if (_factory != IDXswapRouter(_router).factory()) revert InvalidRouterOrFactory();
        supportedDEXs[_dexIndex] = DEX({name: _name, router: _router, factory: _factory});
    }

    // TODO
    function removeSupportedDEX(uint8 _dexIndex) external onlyOwner {
        supportedDEXs[_dexIndex].router = address(0);
        supportedDEXs[_dexIndex].factory = address(0);
        supportedDEXs[_dexIndex].name = '';
    }

    function getSupportedDEX(uint8 _dexIndex) public view returns (address router, address factory) {
        router = supportedDEXs[_dexIndex].router;
        factory = supportedDEXs[_dexIndex].factory;
        if (router == address(0) || factory == address(0)) revert InvalidRouterOrFactory();
    }

    /// @notice Sets the fee receiver address
    /// @param _feeTo The address to send received zap fee
    function setFeeTo(address _feeTo) external {
        if (msg.sender != feeToSetter) revert OnlyFeeSetter();
        feeTo = _feeTo;
    }

    /// @notice Sets the setter address
    /// @param _feeToSetter The address of the fee setter
    function setFeeToSetter(address _feeToSetter) external {
        if (msg.sender != feeToSetter) revert OnlyFeeSetter();
        feeToSetter = _feeToSetter;
    }

    /// @notice Sets the protocol fee percent
    /// @param _protocolFee The new protocol fee percent
    function setProtocolFee(uint16 _protocolFee) external {
        if (msg.sender != feeToSetter) revert OnlyFeeSetter();
        if (_protocolFee > 10000) revert ForbiddenValue();
        protocolFee = _protocolFee;
    }

    ///@notice Withdraw protocolFee share, retaining affilliate share
    function withdrawTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 qty;

            if (tokens[i] == ETHAddress) {
                qty = address(this).balance - totalAffiliateBalance[tokens[i]];
                TransferHelper.safeTransferETH(owner, qty);
            } else {
                qty = IERC20(tokens[i]).balanceOf(address(this)) - totalAffiliateBalance[tokens[i]];
                TransferHelper.safeTransfer(tokens[i], owner, qty);
            }
        }
    }

    ///@notice Withdraw affilliate share, retaining protocolFee share
    function affilliateWithdraw(address[] calldata tokens) external {
        uint256 tokenBal;
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenBal = affiliateBalance[msg.sender][tokens[i]];
            affiliateBalance[msg.sender][tokens[i]] = 0;
            totalAffiliateBalance[tokens[i]] = totalAffiliateBalance[tokens[i]] - tokenBal;

            if (tokens[i] == ETHAddress) {
                TransferHelper.safeTransferETH(msg.sender, tokenBal);
            } else {
                TransferHelper.safeTransfer(tokens[i], msg.sender, tokenBal);
            }
        }
    }

    /// @notice Gets and validates pair's address
    /// @param tokenA The addres of the first token of the pair
    /// @param tokenB The addres of the second token of the pair
    /// @return pair The address of the pair
    function _getPairAddress(
        address tokenA,
        address tokenB,
        address factory
    ) internal view returns (address pair) {
        pair = IDXswapFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) revert InvalidPair();
    }

    /// @notice Approves the token if needed
    /// @param token The address of the token
    /// @param amount The amount of token to send
    function _approveTokenIfNeeded(
        address token,
        uint256 amount,
        address router
    ) internal {
        if (IERC20(token).allowance(address(this), router) < amount) {
            // Note: some tokens (e.g. USDT, KNC) allowance must be first reset
            // to 0 before being able to update it
            TransferHelper.safeApprove(token, router, 0);
            TransferHelper.safeApprove(token, router, amount);
        }
    }

    function _removeLiquidity(
        address tokenA,
        address tokenB,
        address lpToken,
        uint256 amountLp,
        uint256 amountAMin,
        uint256 amountBMin,
        address router
    ) internal returns (uint256 amountA, uint256 amountB) {
        _approveTokenIfNeeded(lpToken, amountLp, router);

        // pull LP tokens from sender
        TransferHelper.safeTransferFrom(lpToken, msg.sender, address(this), amountLp);

        // removeLiquidity sort tokens so no need to set them in exact order
        (amountA, amountB) = IDXswapRouter(router).removeLiquidity(
            tokenA,
            tokenB,
            amountLp,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        );

        if (amountA == 0 || amountB == 0) revert InsufficientMinAmount();
    }

    function _getFeeAndTransferTokens(
        address tokenTo,
        uint256 amountTo,
        address to,
        address affiliate
    ) internal returns (uint256 amountTransferred) {
        uint256 totalProtocolFeePortion;
        // transfer toTokens to sender
        if (tokenTo == address(0)) {
            totalProtocolFeePortion = _subtractProtocolFee(ETHAddress, amountTo, affiliate);
            TransferHelper.safeTransferETH(to, amountTo - totalProtocolFeePortion);
        } else {
            totalProtocolFeePortion = _subtractProtocolFee(tokenTo, amountTo, affiliate);
            TransferHelper.safeTransfer(tokenTo, to, amountTo - totalProtocolFeePortion);
        }

        amountTransferred = amountTo - totalProtocolFeePortion;
    }

    function _swapLpTokensToTargetTokens(
        uint256 amountA,
        uint256 amountB,
        SwapTx calldata swapTokenA,
        SwapTx calldata swapTokenB,
        address to
    ) internal returns (uint256 amountTo) {
        (address routerSwapA, ) = getSupportedDEX(swapTokenA.dexIndex);
        (address routerSwapB, ) = getSupportedDEX(swapTokenB.dexIndex);
        amountTo =
            _swapExactTokensForTokens(amountA, swapTokenA.amountMin, swapTokenA.path, to, routerSwapA) +
            _swapExactTokensForTokens(amountB, swapTokenB.amountMin, swapTokenB.path, to, routerSwapB);
    }
}
