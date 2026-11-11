import { headers } from "next/headers";
import { originFrom } from "./request-origin";

/** The same as `originFrom`, for server code with no request in hand (server actions and components). */
export async function appOrigin(): Promise<string> {
  return originFrom(await headers());
}
