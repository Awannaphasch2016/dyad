export function clerkPublishableKey(): string | undefined {
  const key = process.env.CLERK_PUBLISHABLE_KEY?.trim();
  return key ? key : undefined;
}
