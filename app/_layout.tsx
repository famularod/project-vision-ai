import { Stack } from 'expo-router/stack';
import Head from 'expo-router/head';
import { DesktopAuthProvider } from '../components/web-shell/desktop-auth-provider';
import { PRODUCT_BRAND } from '../product-brand';

export default function RootLayout() {
  return (
    <DesktopAuthProvider>
      <Head>
        <title>{`${PRODUCT_BRAND.name} Command Center`}</title>
        <meta name="application-name" content={PRODUCT_BRAND.name} />
        <meta name="apple-mobile-web-app-title" content={PRODUCT_BRAND.name} />
        <meta name="theme-color" content="#194A91" />
      </Head>
      <Stack screenOptions={{ headerShown: false }} />
    </DesktopAuthProvider>
  );
}
