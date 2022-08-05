//SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@swapr/core/contracts/interfaces/IDXswapFactory.sol";
import "@swapr/core/contracts/interfaces/IDXswapPair.sol";
import "@swapr/core/contracts/interfaces/IERC20.sol";
import "@swapr/core/contracts/interfaces/IWETH.sol";
import "@swapr/periphery/contracts/interfaces/IDXswapRouter.sol";
import "@swapr/periphery/contracts/libraries/TransferHelper.sol";


/// @title Zap
/// @notice Allows to zapIn from an ERC20 or wrapped native currency to swapr pair and
/// zapOut from a swapr pair to an ERC20 or wrapped native currency
/// @dev Dusts from zap can be withdrawn by owner
contract Zap is Ownable, ReentrancyGuard {
    /* ========== VARIABLES ========== */

    address public immutable nativeCurrencyWrapper;
    IDXswapFactory public immutable factory;
    IDXswapRouter public immutable router;

    /* ========== EVENTS ========== */

    event ZapInToken(
        address indexed sender,
        address indexed tokenFrom,
        uint256 amountFrom,
        address indexed pairTo,
        uint256 amountTo
    );

    event ZapInNativeCurrencyWrapper(
        address indexed sender,
        uint256 amountNativeCurrencyWrapper,
        address indexed pairTo,
        uint256 amountTo
    );

    event ZapOutToken(
        address indexed sender,
        address indexed pairFrom,
        uint256 amountFrom,
        address tokenTo,
        uint256 amountTo
    );

    event ZapOutNativeCurrencyWrapper(
        address indexed sender,
        address indexed pairFrom,
        uint256 amountFrom,
        uint256 amountNativeCurrencyWrapper
    );

    /* ========== INITIALIZER ========== */

    /// @notice Constructor
    /// @param _router The address of router
    constructor(address _router) {
        require(_router != address(0), "Zap: router can't be address 0");

        router = IDXswapRouter(_router);
        factory = IDXswapFactory(IDXswapRouter(_router).factory());
        nativeCurrencyWrapper = IDXswapRouter(_router).WETH();
    }

    /* ========== EXTERNAL FUNCTIONS ========== */

    /// @notice TokenFrom is the first value of `pathToPairToken(0/1)` array.
    /// Swaps half of it to token0 and the other half token1 and add liquidity
    /// with the swapped amounts
    /// @dev Any excess from adding liquidity is kept by Zap
    /// @param amountFrom The amountFrom of tokenFrom to zap
    /// @param amount0Min The min amount to receive of token0
    /// @param amount1Min The min amount to receive of token1
    /// @param pathToPairToken0 The path to the pair's token0
    /// @param pathToPairToken1 The path to the pair's token1
    function zapInToken(
        uint256 amountFrom,
        uint256 amount0Min,
        uint256 amount1Min,
        address[] calldata pathToPairToken0,
        address[] calldata pathToPairToken1
    ) external nonReentrant {
        require(amountFrom > 0, "Zap: Insufficient amount");
        address pair = factory.getPair(
            pathToPairToken0[pathToPairToken0.length - 1],
            pathToPairToken1[pathToPairToken1.length - 1]
        ); // Not necessary, but improves contract clarity
        require(pair != address(0), "Zap: Invalid target path");

        address token = pathToPairToken0[0];

        // Transfer tax tokens safeguard
        uint256 previousBalance = IERC20(token).balanceOf(address(this));
        TransferHelper.safeTransferFrom(token, _msgSender(), address(this), amountFrom);
        uint256 amountReceived = (IERC20(token).balanceOf(address(this))) - (previousBalance);

        uint256 amountTo = _zapInToken(
            token,
            amountReceived,
            amount0Min,
            amount1Min,
            pathToPairToken0,
            pathToPairToken1
        );

        emit ZapInToken(_msgSender(), token, amountFrom, pair, amountTo);
    }

    /// @notice Swaps half of NativeCurrencyWrapper to token0 and the other half token1 and
    /// add liquidity with the swapped amounts
    /// @dev Any excess from adding liquidity is kept by Zap
    /// @param amount0Min The min amount of token0 to add liquidity
    /// @param amount1Min The min amount to token1 to add liquidity
    /// @param pathToPairToken0 The path to the pair's token0
    /// @param pathToPairToken1 The path to the pair's token1
    function zapInNativeCurrencyWrapper(
        uint256 amount0Min,
        uint256 amount1Min,
        address[] calldata pathToPairToken0,
        address[] calldata pathToPairToken1
    ) external payable nonReentrant {
        require(msg.value > 0, "Zap: Insufficient amount");
        require(
            pathToPairToken0[0] == nativeCurrencyWrapper && pathToPairToken1[0] == nativeCurrencyWrapper,
            "Zap: Invalid start path"
        );
        address pair = factory.getPair(
            pathToPairToken0[pathToPairToken0.length - 1],
            pathToPairToken1[pathToPairToken1.length - 1]
        ); // Not necessary, but improves contract clarity
        require(pair != address(0), "Zap: Invalid target path");

        IWETH(nativeCurrencyWrapper).deposit{value: msg.value}();

        uint256 liquidity = _zapInToken(
            nativeCurrencyWrapper,
            msg.value,
            amount0Min,
            amount1Min,
            pathToPairToken0,
            pathToPairToken1
        );

        emit ZapInNativeCurrencyWrapper(_msgSender(), msg.value, pair, liquidity);
    }

    /// @notice Unwrap Pair and swap the 2 tokens to path(0/1)[-1]
    /// @dev path0 and path1 do not need to be ordered
    /// @param amountFrom The amount of liquidity to zap
    /// @param amountToMin The min amount to receive of tokenTo
    /// @param path0 The path to one of the pair's token
    /// @param path1 The path to one of the pair's token
    function zapOutToken(
        uint256 amountFrom,
        uint256 amountToMin,
        address[] calldata path0,
        address[] calldata path1
    ) external nonReentrant {
        IDXswapPair pairFrom = IDXswapPair(factory.getPair(path0[0], path1[0]));
        require(address(pairFrom) != address(0), "Zap: Invalid start path");

        uint256 amount = _zapOutToken(
            pairFrom,
            amountFrom,
            amountToMin,
            path0,
            path1,
            _msgSender()
        );

        emit ZapOutToken(_msgSender(), address(pairFrom), amountFrom, path0[0], amount);
    }

    /// @notice Unwrap Pair and swap the 2 tokens to path(0/1)[-1]
    /// @dev path0 and path1 do not need to be ordered
    /// @param amountFrom The amount of liquidity to zap
    /// @param amountToMin The min amount to receive of token1
    /// @param path0 The path to one of the pair's token
    /// @param path1 The path to one of the pair's token
    function zapOutNativeCurrencyWrapper(
        uint256 amountFrom,
        uint256 amountToMin,
        address[] calldata path0,
        address[] calldata path1
    ) external nonReentrant {
        require(
            path0[path0.length - 1] == nativeCurrencyWrapper,
            "Zap: Invalid target path"
        );
        IDXswapPair pairFrom = IDXswapPair(factory.getPair(path0[0], path1[0]));
        require(address(pairFrom) != address(0), "Zap: Invalid start path");

        uint256 amountNativeCurrencyWrapper = _zapOutToken(
            pairFrom,
            amountFrom,
            amountToMin,
            path0,
            path1,
            address(this)
        );

        IWETH(nativeCurrencyWrapper).withdraw(amountNativeCurrencyWrapper);
        TransferHelper.safeTransferETH(_msgSender(), amountNativeCurrencyWrapper);

        emit ZapOutNativeCurrencyWrapper(
            _msgSender(),
            address(pairFrom),
            amountFrom,
            amountNativeCurrencyWrapper
        );
    }

    /// @notice Allows the contract to receive NativeCurrencyWrapper
    /// @dev It is necessary to be able to receive NativeCurrencyWrapper when using nativeCurrencyWrapper.withdraw()
    receive() external payable {}

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice Withdraw token to owner of the Zap contract
    /// @dev if token's address is null address, sends NativeCurrencyWrapper
    /// @param token The token to withdraw
    function withdraw(address token) external onlyOwner {
        if (token == address(0)) {
            TransferHelper.safeTransferETH(_msgSender(), address(this).balance);
        } else {
            uint amount = IERC20(token).balanceOf(address(this));
            IERC20(token).transfer(_msgSender(), amount);
        }
    }

    /* ========== Private Functions ========== */

    /// @notice Swaps half of tokenFrom to token0 and the other half token1 and add liquidity
    /// with the swapped amounts
    /// @dev Any excess from adding liquidity is kept by Zap
    /// @param token The token to zap from
    /// @param amountFrom The amountFrom of tokenFrom to zap
    /// @param amount0Min The min amount to receive of token0
    /// @param amount1Min The min amount to receive of token1
    /// @param pathToPairToken0 The path to the pair's token0
    /// @param pathToPairToken1 The path to the pair's token
    /// @return liquidity The amount of liquidity received
    function _zapInToken(
        address token,
        uint256 amountFrom,
        uint256 amount0Min,
        uint256 amount1Min,
        address[] calldata pathToPairToken0,
        address[] calldata pathToPairToken1
    ) private returns (uint256 liquidity) {
        require(
            pathToPairToken0[0] == pathToPairToken1[0],
            "Zap: Invalid start path"
        );
        _approveTokenIfNeeded(token, amountFrom);

        uint256 sellAmount = amountFrom / 2;
        uint256 amount0 = _swapExactTokensForTokens(
            sellAmount,
            0,
            pathToPairToken0,
            address(this)
        );
        uint256 amount1 = _swapExactTokensForTokens(
            amountFrom - sellAmount,
            0,
            pathToPairToken1,
            address(this)
        );

        require(
            amount0 >= amount0Min && amount1 >= amount1Min,
            "Zap: insufficient swap amounts"
        );

        liquidity = _addLiquidity(
            amount0,
            amount1,
            amount0Min,
            amount1Min,
            pathToPairToken0,
            pathToPairToken1
        );
    }

    /// @notice Unwrap Pair and swap the 2 tokens to path(0/1)[-1]
    /// @dev path0 and path1 do not need to be ordered
    /// @param pair The pair to unwrap
    /// @param amountFrom The amount of liquidity to zap
    /// @param amountToMin The min amount to receive of token1
    /// @param path0 The path to one of the pair's token
    /// @param path1 The path to one of the pair's token
    /// @param to The address to send the token
    /// @return amountTo The amount of tokenTo received
    function _zapOutToken(
        IDXswapPair pair,
        uint256 amountFrom,
        uint256 amountToMin,
        address[] calldata path0,
        address[] calldata path1,
        address to
    ) private returns (uint256 amountTo) {
        require(amountFrom > 0, "Zap: Insufficient amount");
        require(
            path0[path0.length - 1] == path1[path1.length - 1],
            "Zap: invalid end path"
        );
        pair.transferFrom(_msgSender(), address(this), amountFrom);

        (uint256 balance0, uint256 balance1) = _removeLiquidity(
            pair,
            amountFrom
        );

        if (path0[0] > path1[0]) {
            (path0, path1) = (path1, path0);
        }

        amountTo = _swapExactTokensForTokens(balance0, 0, path0, to);
        amountTo = amountTo + (_swapExactTokensForTokens(balance1, 0, path1, to));

        require(amountTo >= amountToMin, "Zap: insufficient swap amounts");
    }

    /// @notice Approves the token if needed
    /// @param token The address of the token
    /// @param amount The amount of token to send
    function _approveTokenIfNeeded(address token, uint256 amount)
        private
    {
        if (IERC20(token).allowance(address(this), address(router)) < amount) {
            TransferHelper.safeApprove(token, address(router), amount);
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
        address[] calldata path,
        address to
    ) private returns (uint256 amountTo) {
        uint256 len = path.length;
        address token = path[len - 1];
        uint256 balanceBefore = IERC20(token).balanceOf(to);

        if (len > 1) {
            _approveTokenIfNeeded(path[0], amountFrom);
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                amountFrom,
                amountToMin,
                path,
                to,
                block.timestamp
            );
            amountTo = IERC20(token).balanceOf(to) - balanceBefore;
        } else {
            if (to != address(this)) {
                TransferHelper.safeTransfer(token, to, amountFrom);
                amountTo = IERC20(token).balanceOf(to) - balanceBefore;
            } else {
                amountTo = amountFrom;
            }
        }
        require(amountTo >= amountToMin, "Zap: insufficient token amount");
    }

    /// @notice Adds liquidity to the pair of the last 2 tokens of paths
    /// @param amount0 The amount of token0 to add to liquidity
    /// @param amount1 The amount of token1 to add to liquidity
    /// @param amount0Min The min amount of token0 to add to liquidity
    /// @param amount1Min The min amount of token0 to add to liquidity
    /// @param pathToPairToken0 The path from tokenFrom to one of the pair's tokens
    /// @param pathToPairToken1 The path from tokenFrom to one of the pair's tokens
    /// @return liquidity The amount of liquidity added
    function _addLiquidity(
        uint256 amount0,
        uint256 amount1,
        uint256 amount0Min,
        uint256 amount1Min,
        address[] calldata pathToPairToken0,
        address[] calldata pathToPairToken1
    ) private returns (uint256 liquidity) {
        (address token0, address token1) = (
            pathToPairToken0[pathToPairToken0.length - 1],
            pathToPairToken1[pathToPairToken1.length - 1]
        );

        _approveTokenIfNeeded(token0, amount0);
        _approveTokenIfNeeded(token1, amount1);

        (, , liquidity) = router.addLiquidity(
            token0,
            token1,
            amount0,
            amount1,
            amount0Min,
            amount1Min,
            _msgSender(), 
            block.timestamp
        );
    }

    /// @notice Removes amount of liquidity from pair
    /// @param amount The amount of liquidity of the pair to unwrap
    /// @param pair The address of the pair
    /// @return token0Balance The actual amount of token0 received
    /// @return token1Balance The actual amount of token received
    function _removeLiquidity(IDXswapPair pair, uint256 amount)
        private
        returns (uint256, uint256)
    {
        _approveTokenIfNeeded(address(pair), amount);

        address token0 = pair.token0();
        address token1 = pair.token1();

        uint256 balance0Before = IERC20(token0).balanceOf(address(this));
        uint256 balance1Before = IERC20(token1).balanceOf(address(this));
        router.removeLiquidity(
            token0,
            token1,
            amount,
            0,
            0,
            address(this),
            block.timestamp
        );

        return (
            IERC20(token0).balanceOf(address(this)) - balance0Before,
            IERC20(token1).balanceOf(address(this)) - balance1Before
        );
    }
}
