import DialerDashboard from "../components/dialer-dashboard";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function ApplicationPage() {
  const user = await requireChatGPTUser("/app");
  return <DialerDashboard userName={user.displayName} userEmail={user.email} />;
}
