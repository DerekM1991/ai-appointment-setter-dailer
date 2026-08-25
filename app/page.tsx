import { getChatGPTUser } from "./chatgpt-auth";
import MarketingSite from "./components/marketing-site";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <MarketingSite page="home" signedIn={Boolean(await getChatGPTUser())} />;
}
