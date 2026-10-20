"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { linkLoginAction, loginAction, registerAction, type FormState } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { TimezoneInput } from "@/components/timezone-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: FormState = {};

function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

export function LoginForm({ suspended }: { suspended?: boolean }) {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-4">
      <ErrorNote message={state.error ?? (suspended ? "This account is suspended." : undefined)} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton variant="brand" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function RegisterForm({ zones }: { zones: string[] }) {
  const [state, action] = useActionState(registerAction, initial);
  return (
    <form action={action} className="space-y-4">
      <ErrorNote message={state.error} />
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required maxLength={80} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <TimezoneInput zones={zones} />
        <p className="text-xs text-muted-foreground">Used to time your evening reminder correctly.</p>
      </div>
      <SubmitButton variant="brand" className="w-full">
        Create account
      </SubmitButton>
    </form>
  );
}

export function LinkLoginForm({ code }: { code: string }) {
  const [state, action] = useActionState(linkLoginAction, initial);
  return (
    <form action={action} className="space-y-4">
      <ErrorNote message={state.error} />
      <input type="hidden" name="code" value={code} />
      <SubmitButton variant="brand" className="w-full">
        Continue to Qorlog
      </SubmitButton>
    </form>
  );
}
