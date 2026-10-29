import type { Metadata } from "next";
import { AuthPage } from "@/app/auth/auth-page";

export const metadata: Metadata = { title: "Log in · Replenish" };

export default function LoginPage() {
  return <AuthPage mode="login" />;
}
