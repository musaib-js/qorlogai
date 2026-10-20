import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth-forms";
import { auth } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user) redirect("/chat");
  const { error } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">Sign in to your timesheets.</p>
      <LoginForm suspended={error === "suspended"} />
      <p className="mt-5 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">Registered through Telegram? Send /web to the bot for a sign-in link.</p>
    </>
  );
}
