import { Stack } from 'expo-router/stack';
import Head from 'expo-router/head';
import { useFonts } from 'expo-font';
import { DesktopAuthProvider } from '../components/web-shell/desktop-auth-provider';
import { PRODUCT_BRAND } from '../product-brand';
import { displayFontFamily } from '../theme/typography';

export default function RootLayout() {
  // The desktop renders before the serif arrives and swaps it in; native
  // builds embed the same file through the expo-font config plugin.
  useFonts({ [displayFontFamily]: require('../assets/fonts/InstrumentSerif-Regular.ttf') });

  return (
    <DesktopAuthProvider>
      <Head>
        <title>{`${PRODUCT_BRAND.name} ${PRODUCT_BRAND.subtitle}`}</title>
        <link rel="icon" href="/favicon.ico?brand=vitruvius-v1" />
        <link rel="shortcut icon" href="/favicon.ico?brand=vitruvius-v1" />
        <meta name="application-name" content={PRODUCT_BRAND.name} />
        <meta name="apple-mobile-web-app-title" content={PRODUCT_BRAND.name} />
        <meta name="theme-color" content="#FBFAF8" />
      </Head>
      <Stack screenOptions={{ headerShown: false }} />
    </DesktopAuthProvider>
  );
}
