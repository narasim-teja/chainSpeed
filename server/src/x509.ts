// @peculiar/x509 needs the reflect-metadata polyfill loaded before it, and a WebCrypto provider.
import "reflect-metadata";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(crypto);

export { x509 };
