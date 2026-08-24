import DialerDashboard from "./components/dialer-dashboard";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return (
    <DialerDashboard userName={user.displayName} userEmail={user.email} />
  );
}
