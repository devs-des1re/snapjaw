import "../styles/globals.css";

export default function RootLayout({ children }: { children?: unknown }) {
  return (
    <>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="robots" content="noindex, nofollow" />
        <script src="/theme.js"></script>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      {children}
    </>
  );
}
