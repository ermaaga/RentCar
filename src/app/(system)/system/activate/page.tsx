import { SetPasswordPage } from "@/app/_lib/set-password-page";
import { redeemSystemAction } from "@/app/actions/auth";
import { SYSTEM_REALM } from "@/modules/auth";

export const dynamic = "force-dynamic";

export default async function SystemActivatePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await props.searchParams;
  return (
    <SetPasswordPage
      realm={SYSTEM_REALM}
      token={typeof token === "string" ? token : undefined}
      action={redeemSystemAction}
    />
  );
}
