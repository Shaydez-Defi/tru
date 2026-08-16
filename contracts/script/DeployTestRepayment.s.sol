// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {TestRepayment} from "../src/TestRepayment.sol";

contract DeployTestRepayment is Script {
    function run() external {
        uint256 pk = vm.envUint("SEPOLIA_PRIVATE_KEY");
        vm.startBroadcast(pk);
        TestRepayment tr = new TestRepayment();
        vm.stopBroadcast();
        console2.log("TestRepayment deployed at:", address(tr));
    }
}