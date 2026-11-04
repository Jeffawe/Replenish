// Database tests need DATABASE_URL before any test file imports the client.
process.loadEnvFile(".env.local");
// Tests must never call a real language model: it is slow, costs money and gives different answers. They pass a fake where they need one.
process.env.AI_REVIEW = "off";
