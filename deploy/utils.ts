import { BigNumber } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const ETHERSCAN_CHAINS = ["1", "3", "4", "5"];

type EtherscanVerifyParams<T extends any[]> = {
    address: string;
    constructorArguments?: T;
};

export const runVerify = async <T extends any[] = any[]>(
    hre: HardhatRuntimeEnvironment,
    transactionHash: string,
    etherscanParams?: EtherscanVerifyParams<T>
) => {
    const chainId = await hre.getChainId();

    console.log("Waiting for tx confirmations...");

    await hre.ethers.provider.waitForTransaction(transactionHash, 5);

    if (ETHERSCAN_CHAINS.includes(chainId)) {
        hre.deployments.log("Verifying on etherscan...");
        return hre.run("verify:verify", etherscanParams);
    } else {
        hre.deployments.log("Verifying on sourcify...");
        return hre.run("sourcify");
    }
};

export const getGasParams = () => {
    const maxFeePerGas = BigNumber.from(20000000000); // 20 GWEI
    const maxPriorityFeePerGas = BigNumber.from(4000000000); //4GWEI
    return { maxFeePerGas, maxPriorityFeePerGas };
};