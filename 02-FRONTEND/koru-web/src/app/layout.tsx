import KoruNavigation from "./KoruNavigation";
import RedisEnterpriseEnhancer from "./RedisEnterpriseEnhancer";
import "./style.css";
import "./redis-enterprise-enhancer.css";

export const metadata = {
  title: "KORU ONE | Enterprise Operations",
  description: "Redis-centric enterprise platform"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body>
        <KoruNavigation />
        <RedisEnterpriseEnhancer />
        {children}
      </body>
    </html>
  );
}
