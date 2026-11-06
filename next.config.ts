import type { NextConfig } from "next";
import { hostname, networkInterfaces } from "node:os";

// Allow this computer's own addresses for Next's development assets/HMR.
// This is deliberately a list of local addresses, not a wildcard allowlist.
let localAddresses: string[] = [];
try {
  localAddresses = Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).flatMap(({ family, address }) =>
      family === "IPv4"
        ? [address]
        : address.includes("%")
          ? []
          : [`[${address}]`],
    ),
  );
} catch {
  // Restricted build containers may deny interface discovery. Localhost and
  // loopback still work; this list is only used by the development server.
}

const config: NextConfig = {
  allowedDevOrigins: [...new Set(["127.0.0.1", hostname(), ...localAddresses])],
};

export default config;
