'use client';
import Script from 'next/script';

/**
 * Microsoft Clarity: free session recordings and heatmaps.
 * Skipped on localhost so your own testing doesn't show up in the dashboard.
 * Override the project with NEXT_PUBLIC_CLARITY_ID, or set it to "off" to disable.
 */
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID || 'ywy02mk063';

export default function Clarity() {
  if (!CLARITY_ID || CLARITY_ID === 'off' || !/^[a-z0-9]{6,16}$/i.test(CLARITY_ID)) return null;
  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){if(/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(l.location.hostname))return;c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_ID}");`}
    </Script>
  );
}
