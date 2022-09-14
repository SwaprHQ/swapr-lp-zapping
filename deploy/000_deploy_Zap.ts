import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { contractConstructorArgs, getDeploymentConfig } from "./deployment.config";
import { Zap__factory } from "../typechain";
import { runVerify } from "./utils";

const deployment: DeployFunction = async function (
    hre: HardhatRuntimeEnvironment
) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();
    const config = getDeploymentConfig(network.name)

    const constructorArgs = contractConstructorArgs<Zap__factory>(
        config?.owner || deployer,
        config?.factory || deployer,
        config?.router || deployer,
        config?.nativeCurrencyWrapper || deployer,
        config?.feeToSetter || deployer,
    )

    const deployResult = await deploy("Zap", {
        from: deployer,
        args: constructorArgs,
        log: true,
    });

    if (deployResult.newlyDeployed && deployResult.transactionHash){
        await runVerify(hre, deployResult.transactionHash, {
            address: deployResult.address,
            constructorArguments: constructorArgs,
        });
    }
};

deployment.tags = ["Zap", "CONTRACTS"];
export default deployment;
