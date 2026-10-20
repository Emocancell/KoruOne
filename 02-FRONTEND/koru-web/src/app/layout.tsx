import KoruNavigation from "./KoruNavigation";
import './style.css';
export const metadata={title:'KORU ONE | Enterprise Operations',description:'Redis-centric enterprise platform'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="tr"><body><KoruNavigation />{children}</body></html>}
