import './globals.css';
import type { Metadata, Viewport } from 'next';
export const metadata: Metadata = {title:{default:'Nexo Avalia',template:'%s | Nexo Avalia'},description:'Plataforma de simulados, desempenho e gestão acadêmica.',applicationName:'Nexo Avalia',icons:{icon:[{url:'/favicon.ico',sizes:'any'},{url:'/brand/favicon-nexo.png',type:'image/png'}],apple:'/apple-icon.png'},robots:{index:true,follow:true}};
export const viewport: Viewport = {width:'device-width',initialScale:1,themeColor:'#f97316'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="pt-BR"><body>{children}</body></html>}
