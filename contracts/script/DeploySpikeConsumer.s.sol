// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {SpikeConsumer} from "../src/spike/SpikeConsumer.sol";

/// @notice Phase 0 spike: deploy the throwaway Creditcoin consumer on CC3 Testnet.
///         Pass the on-chain EvmV1Decoder library address as the constructor arg.
contract DeploySpikeConsumer is Script {
    function run() external {
        // EvmV1Decoder library deployed on CC3 Testnet (see docs/usc-research.md)
        address decoder = vm.envOr("DECODER_CONTRACT", address(0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f));
        uint256 pk = vm.envUint("CREDITCOIN_PRIVATE_KEY");
        vm.startBroadcast(pk);
        SpikeConsumer sc = new SpikeConsumer(decoder);
        vm.stopBroadcast();
        console2.log("SpikeConsumer deployed at:", address(sc));
    }
}