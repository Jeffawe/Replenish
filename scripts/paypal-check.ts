// Checks PayPal accepts the client ID and secret in .env.local. Charges nothing and never prints the secret.
//   npm run paypal:check
import { checkPaypalCredentials } from "../src/modules/orders";

checkPaypalCredentials().then(
  (result) => {
    console.log(`${result.ok ? "OK" : "NOT OK"}: ${result.message}`);
    process.exit(result.ok ? 0 : 1);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
