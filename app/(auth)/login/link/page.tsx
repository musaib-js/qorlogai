import { LinkLoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in with Telegram link" };

/**
 * The code is only consumed when the button is pressed (POST), never on page load, so link-preview
 * bots and prefetchers can't burn the one-time code.
 */
export default async function LinkLoginPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  if (!code) {
    return <p className="text-sm text-muted-foreground">This link is incomplete. Send /web to the Qorlog bot on Telegram to get a new one.</p>;
  }
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Sign in from Telegram</h1>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">You asked the Qorlog bot for a sign-in link. Continue to open your account in this browser.</p>
      <LinkLoginForm code={code} />
    </>
  );
}
