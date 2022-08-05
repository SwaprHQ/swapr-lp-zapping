import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployment: DeployFunction = async function (
    hre: HardhatRuntimeEnvironment
) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;

    const { deployer } = await getNamedAccounts();

    await deploy("Zap", {
        from: deployer,
        log: true,
    });
};
deployment.tags = ["ZAP", "CONTRACTS"];
export default deployment;
