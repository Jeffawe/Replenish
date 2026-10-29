import type { Metadata } from "next";
import { AuthPage } from "@/app/auth/auth-page";

export const metadata: Metadata = { title: "Sign up · Replenish" };

export default function SignUpPage() {
  return <AuthPage mode="signup" />;
}
