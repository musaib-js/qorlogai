import Link from "next/link";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth-forms";
import { auth } from "@/lib/auth";
import { listTimezones } from "@/lib/time";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if ((await auth())?.user) redirect("/chat");
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">Two minutes to timesheets that fill themselves.</p>
      <RegisterForm zones={listTimezones()} />
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
