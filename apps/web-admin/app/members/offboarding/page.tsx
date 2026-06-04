import MembersPage from "../page";

export const dynamic = "force-dynamic";

type OffboardingPageProps = {
  searchParams?: Promise<{
    focusMemberId?: string;
    workspaceId?: string;
    q?: string;
    status?: string;
    role?: string;
    view?: string;
    section?: string;
    focus?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

export default async function MemberOffboardingPage({
  searchParams,
}: OffboardingPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return MembersPage({
    searchParams: Promise.resolve({
      ...resolvedSearchParams,
      section: "offboarding",
    }),
  });
}
